# Post-provision hook: seeds DB + builds and deploys the hosted agent.
# Fail-loud: any non-zero exit code from sub-commands aborts the hook so
# `azd up` surfaces the real failure instead of reporting success.
$ErrorActionPreference = 'Stop'

function Invoke-Checked {
    param([string]$Label)
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [ERR] $Label failed (exit $LASTEXITCODE)" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

function Get-AzdEnvValue {
    param([string]$Name)

    $azdRoot = if (-not [string]::IsNullOrWhiteSpace($env:AZD_ENV_ROOT)) {
        $env:AZD_ENV_ROOT
    } else {
        (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
    }

    Push-Location $azdRoot
    try {
        $value = azd env get-value $Name
        Invoke-Checked "azd env get-value $Name"
        return $value.Trim()
    } finally {
        Pop-Location
    }
}

Write-Host "Running post-provision setup..." -ForegroundColor Cyan

Push-Location $PSScriptRoot
try {
    # --- Read azd env outputs ---
    $pgName = Get-AzdEnvValue "POSTGRESQL_NAME"
    $rg     = Get-AzdEnvValue "AZURE_RESOURCE_GROUP"
    $upn    = (az ad signed-in-user show --query userPrincipalName -o tsv)
    Invoke-Checked 'az ad signed-in-user show (upn)'
    $oid    = (az ad signed-in-user show --query id -o tsv)
    Invoke-Checked 'az ad signed-in-user show (oid)'

    if (-not ($pgName -and $rg -and $upn -and $oid)) {
        Write-Host "  [ERR] Missing POSTGRESQL_NAME / AZURE_RESOURCE_GROUP / signed-in user" -ForegroundColor Red
        exit 1
    }

    # --- Grant deployer Entra admin on PG so setup.py can authenticate ---
    Write-Host "Granting PostgreSQL Entra admin to deployer ($upn)..." -ForegroundColor Cyan
    $adminOutput = az postgres flexible-server microsoft-entra-admin create `
        --resource-group $rg `
        --server-name $pgName `
        --object-id $oid `
        --display-name $upn `
        --type User `
        --only-show-errors 2>&1
    if ($LASTEXITCODE -ne 0) {
        # "already exists" is benign and idempotent on re-runs.
        if ($adminOutput -match 'already exists') {
            Write-Host "  [OK] Entra admin already configured" -ForegroundColor Green
        } else {
            Write-Host "  [ERR] ad-admin create failed: $adminOutput" -ForegroundColor Red
            exit $LASTEXITCODE
        }
    } else {
        Write-Host "  [OK] $upn granted PG Entra admin" -ForegroundColor Green
    }

    # --- Open PG firewall to the deployer's public IP ---
    # Bicep only allows AllowAllAzureServicesAndResourcesWithinAzureIps (the
    # 0.0.0.0/0.0.0.0 sentinel rule), so connections from the dev machine
    # would otherwise hang on TCP timeout. Rule is idempotent and named after
    # the IP so prior runs are reused / can be pruned manually.
    Write-Host "Opening PG firewall for deployer IP..." -ForegroundColor Cyan
    try {
        $ip = (Invoke-RestMethod -Uri 'https://api.ipify.org' -TimeoutSec 10).Trim()
    } catch {
        Write-Host "  [ERR] Unable to detect public IP: $_" -ForegroundColor Red
        exit 1
    }
    if ($ip -notmatch '^\d+\.\d+\.\d+\.\d+$') {
        Write-Host "  [ERR] ipify returned non-IP value: '$ip'" -ForegroundColor Red
        exit 1
    }
    $ruleName = "azd-deployer-$($ip -replace '\.','-')"
    $fwOutput = az postgres flexible-server firewall-rule create `
        --resource-group $rg `
        --name $pgName `
        --rule-name $ruleName `
        --start-ip-address $ip `
        --end-ip-address $ip `
        --only-show-errors 2>&1
    if ($LASTEXITCODE -ne 0 -and $fwOutput -notmatch 'already exists') {
        Write-Host "  [ERR] firewall-rule create failed: $fwOutput" -ForegroundColor Red
        exit $LASTEXITCODE
    }
    Write-Host "  [OK] Firewall rule '$ruleName' for $ip" -ForegroundColor Green

    # Belt-and-suspenders for cp1252 PowerShell pipes consuming Python output.
    $env:PYTHONIOENCODING = "utf-8"

    # --- Provision venv + install requirements ---
    if (-not (Test-Path ".venv")) {
        python -m venv .venv
        Invoke-Checked 'python -m venv .venv'
    }
    & ".venv\Scripts\python.exe" -m pip install --quiet --disable-pip-version-check -r requirements.txt
    Invoke-Checked 'pip install requirements'

    # --- Run setup.py (seeds DB, builds image, deploys + starts hosted agent) ---
    & ".venv\Scripts\python.exe" setup.py
    Invoke-Checked 'setup.py'
} finally {
    Pop-Location
}
