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
