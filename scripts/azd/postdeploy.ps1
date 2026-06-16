$ErrorActionPreference = "Stop"

# The infra provisions the container apps with minReplicas = 0 so the very first
# revision (a public placeholder image) can come up cleanly before azd deploy
# pushes the real images. Once the real images are deployed, bump both apps to
# minReplicas = 1 so the conference demo is always warm (no cold starts).

function Get-RequiredAzdEnvValue {
    param([string] $Name)

    $value = azd env get-value $Name 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($value)) {
        throw "Missing required AZD environment value '$Name'. Run 'azd provision' before deploying."
    }

    return $value.Trim()
}

$resourceGroup = Get-RequiredAzdEnvValue "AZURE_RESOURCE_GROUP"
$webContainerAppName = Get-RequiredAzdEnvValue "AZURE_WEB_CONTAINER_APP_NAME"
$apiContainerAppName = Get-RequiredAzdEnvValue "AZURE_API_CONTAINER_APP_NAME"

foreach ($containerAppName in @($apiContainerAppName, $webContainerAppName)) {
    Write-Host "Ensuring $containerAppName stays warm (minReplicas = 1)..."
    az containerapp update `
        --name $containerAppName `
        --resource-group $resourceGroup `
        --min-replicas 1 `
        --max-replicas 1 `
        --output none
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to set minReplicas on '$containerAppName'."
    }
}

Write-Host "Both container apps set to always-on (minReplicas = 1)."

# Grant the Foundry hosted-agent runtime identity its data-plane access (PG Entra
# admin + Storage Blob Data Contributor). The runtime identity only exists after
# the agent is invoked and is regenerated on every clean rebuild, so this runs
# here (post-deploy) using the now-warm api to discover it. Non-fatal: a probe
# miss must never fail `azd up` - the core infra/agents/api are already deployed,
# and the grant can be re-run manually with -ApiBaseUrl.
try {
    $apiFqdn = az containerapp show `
        --name $apiContainerAppName `
        --resource-group $resourceGroup `
        --query "properties.configuration.ingress.fqdn" -o tsv 2>$null
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($apiFqdn)) {
        $grantScript = Join-Path $PSScriptRoot "grant-agent-access.ps1"
        Write-Host "Granting hosted-agent data-plane access (api: https://$apiFqdn)..."
        & $grantScript -ApiBaseUrl "https://$apiFqdn"
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "grant-agent-access.ps1 did not complete. Re-run manually: pwsh ./scripts/azd/grant-agent-access.ps1 -ApiBaseUrl https://$apiFqdn"
        }
    } else {
        Write-Warning "Could not resolve api FQDN; skipping hosted-agent grant. Re-run manually once the api is warm."
    }
} catch {
    Write-Warning "Hosted-agent grant step failed ($($_.Exception.Message)). Re-run manually: pwsh ./scripts/azd/grant-agent-access.ps1 -ApiBaseUrl https://<api-fqdn>"
}
