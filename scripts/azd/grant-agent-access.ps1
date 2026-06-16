# Grants the Foundry hosted-agent runtime identity the data-plane access it needs:
#   1. PostgreSQL Entra admin (so get_market_data / execute_code can authenticate)
#   2. Storage Blob Data Contributor on the chart-upload account (so charts upload)
#
# WHY THIS EXISTS
# The infra (postgresql.bicep / storage.bicep) grants these roles to the AI
# *project's* managed identity. But a Foundry hosted agent does NOT run as the
# project identity - it runs under a separate, platform-managed runtime identity
# that only exists AFTER the agent is deployed and is not derivable in Bicep.
# So the grants have to target that runtime principal, and that can only happen
# post-deploy. This script is the durable, idempotent encoding of that step.
#
# DISCOVERY
# Pass -ApiBaseUrl to auto-discover the runtime identity: the script asks the
# unsecure agent (through the deployed api, which holds the Azure AI User role)
# to run execute_code that prints the object id on its own AAD token. The secure
# and unsecure agents share this identity, so one probe covers both. The result
# is cached in the azd env (AGENT_RUNTIME_PRINCIPAL_ID) for subsequent runs.
# You can also set it by hand if you already know it:
#   azd env set AGENT_RUNTIME_PRINCIPAL_ID <guid>
# All operations below are ARM-only (no Microsoft Graph) and idempotent, so it is
# safe to run on every deploy. Run from the repo root.

param(
    [string]$ApiBaseUrl
)

$ErrorActionPreference = 'Stop'

function Get-AzdEnvValue {
    param([string]$Name, [switch]$Required)
    $value = (azd env get-value $Name 2>$null)
    if ($LASTEXITCODE -ne 0) { $value = '' }
    $value = "$value".Trim()
    if ($Required -and [string]::IsNullOrWhiteSpace($value)) {
        throw "Missing required azd environment value '$Name'."
    }
    return $value
}

function Resolve-AgentPrincipalId {
    param([string]$ApiBaseUrl)

    # execute_code runs inside the agent container under its runtime identity, so
    # the oid on a token it mints is exactly the principal PostgreSQL/Storage must
    # trust. Minting a token needs no RBAC, so this works before any grant exists.
    $code = @'
import base64, json
from azure.identity import DefaultAzureCredential
t = DefaultAzureCredential().get_token("https://ossrdbms-aad.database.windows.net/.default").token
p = t.split(".")[1]; p += "=" * (-len(p) % 4)
print("AGENT_OID:" + json.loads(base64.urlsafe_b64decode(p))["oid"])
'@
    $prompt = @"
Deployment health check. Call the execute_code tool with EXACTLY this Python (do
not modify it, do not add or remove anything) and then reply with only its stdout:

``````python
$code
``````
"@
    $body = @{ scenario = 'unsecure-hacker'; prompt = $prompt } | ConvertTo-Json -Depth 5
    $deadline = (Get-Date).AddMinutes(8)
    $attempt = 0
    while ((Get-Date) -lt $deadline) {
        $attempt++
        try {
            $resp = Invoke-RestMethod -Method Post -Uri "$ApiBaseUrl/demos/run" `
                -ContentType 'application/json' -Body $body -TimeoutSec 180
            $hay = "$($resp.textResponse)`n" + ($resp | ConvertTo-Json -Depth 15 -Compress)
            $m = [regex]::Match($hay, 'AGENT_OID:([0-9a-fA-F-]{36})')
            if ($m.Success) { return $m.Groups[1].Value }
            Write-Host "  [..] probe attempt $attempt returned no oid; retrying..." -ForegroundColor DarkYellow
        } catch {
            Write-Host "  [..] probe attempt $attempt error: $($_.Exception.Message)" -ForegroundColor DarkYellow
        }
        Start-Sleep -Seconds 15
    }
    return $null
}

$rg              = Get-AzdEnvValue 'AZURE_RESOURCE_GROUP' -Required
$pgName          = Get-AzdEnvValue 'POSTGRESQL_NAME' -Required
$pgRole          = Get-AzdEnvValue 'PROJECT_NAME' -Required        # = DATABASE_URL user=
$storageAccount  = Get-AzdEnvValue 'CHART_STORAGE_ACCOUNT' -Required
$agentPrincipal  = Get-AzdEnvValue 'AGENT_RUNTIME_PRINCIPAL_ID'

if (-not [string]::IsNullOrWhiteSpace($ApiBaseUrl)) {
    # Authoritative discovery. The runtime identity is regenerated on every clean
    # rebuild, so whenever we can reach the api we re-probe rather than trust a
    # cached (possibly stale) value, then refresh the cache.
    Write-Host "Discovering hosted-agent runtime identity via $ApiBaseUrl ..." -ForegroundColor Cyan
    $discovered = Resolve-AgentPrincipalId -ApiBaseUrl $ApiBaseUrl
    if (-not [string]::IsNullOrWhiteSpace($discovered)) {
        if ($discovered -ne $agentPrincipal) {
            azd env set AGENT_RUNTIME_PRINCIPAL_ID $discovered 2>$null | Out-Null
        }
        $agentPrincipal = $discovered
        Write-Host "  [OK] Agent runtime identity: $agentPrincipal" -ForegroundColor Green
    } elseif (-not [string]::IsNullOrWhiteSpace($agentPrincipal)) {
        Write-Host "  [..] Probe failed; falling back to cached AGENT_RUNTIME_PRINCIPAL_ID $agentPrincipal" -ForegroundColor DarkYellow
    }
}

if ([string]::IsNullOrWhiteSpace($agentPrincipal)) {
    Write-Host "AGENT_RUNTIME_PRINCIPAL_ID is not set and could not be discovered." -ForegroundColor Yellow
    Write-Host "Re-run once the api is deployed and warm:" -ForegroundColor Yellow
    Write-Host "    pwsh ./scripts/azd/grant-agent-access.ps1 -ApiBaseUrl https://<api-fqdn>" -ForegroundColor Yellow
    Write-Host "or set it explicitly if you already know the agent runtime oid:" -ForegroundColor Yellow
    Write-Host "    azd env set AGENT_RUNTIME_PRINCIPAL_ID <guid>" -ForegroundColor Yellow
    exit 1
}

Write-Host "Granting hosted-agent access to runtime principal $agentPrincipal" -ForegroundColor Cyan

# --- 1. PostgreSQL Entra admin bound to the agent runtime identity -------------
# The agent connects as PG role '$pgRole'. PostgreSQL validates the token oid
# against the security label bound to that role, so the admin entry that carries
# the role name must point at the agent runtime identity. Re-point it if a stale
# entry (e.g. the project identity from Bicep) currently owns the role name.
Write-Host "Ensuring PostgreSQL Entra admin '$pgRole' -> $agentPrincipal..." -ForegroundColor Cyan
$adminsJson = az postgres flexible-server microsoft-entra-admin list `
    --resource-group $rg --server-name $pgName --only-show-errors 2>$null
$admins = @()
if ($LASTEXITCODE -eq 0 -and $adminsJson) { $admins = $adminsJson | ConvertFrom-Json }

$alreadyBound = $admins | Where-Object { $_.objectId -eq $agentPrincipal }
if ($alreadyBound) {
    Write-Host "  [OK] Agent identity already a PG Entra admin." -ForegroundColor Green
} else {
    # Remove any stale admin that owns the agent's role name but a different oid.
    foreach ($stale in ($admins | Where-Object { $_.principalName -eq $pgRole -and $_.objectId -ne $agentPrincipal })) {
        Write-Host "  Removing stale admin '$($stale.principalName)' ($($stale.objectId))..." -ForegroundColor DarkYellow
        az postgres flexible-server microsoft-entra-admin delete `
            --resource-group $rg --server-name $pgName `
            --object-id $stale.objectId --yes --only-show-errors | Out-Null
    }
    az postgres flexible-server microsoft-entra-admin create `
        --resource-group $rg --server-name $pgName `
        --object-id $agentPrincipal --display-name $pgRole `
        --type ServicePrincipal --only-show-errors | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to set PostgreSQL Entra admin for the agent identity." }
    Write-Host "  [OK] PG Entra admin '$pgRole' now bound to the agent identity." -ForegroundColor Green
}

# --- 2. Storage Blob Data Contributor on the chart-upload account --------------
# Includes the generateUserDelegationKey action used to sign short-lived chart
# SAS URLs while keeping the account private (allowBlobPublicAccess = false).
$storageId = az storage account show --name $storageAccount --resource-group $rg `
    --query id -o tsv --only-show-errors
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($storageId)) {
    throw "Could not resolve storage account id for '$storageAccount'."
}
Write-Host "Ensuring Storage Blob Data Contributor on '$storageAccount'..." -ForegroundColor Cyan
$existing = az role assignment list `
    --assignee $agentPrincipal --scope $storageId `
    --role "Storage Blob Data Contributor" --query "[].id" -o tsv --only-show-errors 2>$null
if (-not [string]::IsNullOrWhiteSpace($existing)) {
    Write-Host "  [OK] Role already assigned." -ForegroundColor Green
} else {
    az role assignment create `
        --assignee-object-id $agentPrincipal --assignee-principal-type ServicePrincipal `
        --role "Storage Blob Data Contributor" --scope $storageId --only-show-errors | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to assign Storage Blob Data Contributor to the agent identity." }
    Write-Host "  [OK] Storage Blob Data Contributor assigned." -ForegroundColor Green
}

Write-Host "Hosted-agent access grants complete." -ForegroundColor Cyan
