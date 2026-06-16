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
# HOW TO GET THE RUNTIME PRINCIPAL ID
# It is the `oid` on the token the agent presents. The agent's PG role
# (DATABASE_URL user=<PROJECT_NAME>) must be bound to it. Capture it once and
# store it in the azd environment:
#   azd env set AGENT_RUNTIME_PRINCIPAL_ID <guid>
# then re-run this script. All operations below are ARM-only (no Microsoft Graph)
# and idempotent, so it is safe to run on every deploy.

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

$rg              = Get-AzdEnvValue 'AZURE_RESOURCE_GROUP' -Required
$pgName          = Get-AzdEnvValue 'POSTGRESQL_NAME' -Required
$pgRole          = Get-AzdEnvValue 'PROJECT_NAME' -Required        # = DATABASE_URL user=
$storageAccount  = Get-AzdEnvValue 'CHART_STORAGE_ACCOUNT' -Required
$agentPrincipal  = Get-AzdEnvValue 'AGENT_RUNTIME_PRINCIPAL_ID'

if ([string]::IsNullOrWhiteSpace($agentPrincipal)) {
    Write-Host "AGENT_RUNTIME_PRINCIPAL_ID is not set." -ForegroundColor Yellow
    Write-Host "The hosted agent runs under a Foundry-managed identity that only exists" -ForegroundColor Yellow
    Write-Host "after the agent is deployed. Capture its object id (the token 'oid' the" -ForegroundColor Yellow
    Write-Host "agent presents to PostgreSQL/Storage), then run:" -ForegroundColor Yellow
    Write-Host "    azd env set AGENT_RUNTIME_PRINCIPAL_ID <guid>" -ForegroundColor Yellow
    Write-Host "    pwsh ./scripts/azd/grant-agent-access.ps1" -ForegroundColor Yellow
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
