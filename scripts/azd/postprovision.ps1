$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$previousAzdEnvRoot = $env:AZD_ENV_ROOT

try {
    $env:AZD_ENV_ROOT = $repoRoot

    foreach ($agentFolder in @("unsecure", "secure")) {
        $postProvision = Join-Path $repoRoot "$agentFolder\scripts\postprovision.ps1"
        if (-not (Test-Path $postProvision)) {
            throw "Missing post-provision script: $postProvision"
        }

        Write-Host "Running $agentFolder hosted-agent post-provision against root azd environment..." -ForegroundColor Cyan
        & $postProvision
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
    }
}
finally {
    if ([string]::IsNullOrEmpty($previousAzdEnvRoot)) {
        Remove-Item Env:\AZD_ENV_ROOT -ErrorAction SilentlyContinue
    }
    else {
        $env:AZD_ENV_ROOT = $previousAzdEnvRoot
    }
}
