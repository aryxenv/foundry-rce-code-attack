$ErrorActionPreference = "Stop"

function Get-RequiredAzdEnvValue {
    param([string] $Name)

    $value = azd env get-value $Name 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($value)) {
        throw "Missing required AZD environment value '$Name'. Run 'azd provision' before deploying."
    }

    return $value.Trim()
}

$resourceGroup = Get-RequiredAzdEnvValue "AZURE_RESOURCE_GROUP"
$registryEndpoint = Get-RequiredAzdEnvValue "AZURE_CONTAINER_REGISTRY_ENDPOINT"
$webContainerAppName = Get-RequiredAzdEnvValue "AZURE_WEB_CONTAINER_APP_NAME"
$apiContainerAppName = Get-RequiredAzdEnvValue "AZURE_API_CONTAINER_APP_NAME"

$registryName = $registryEndpoint.Split(".")[0]
$registryId = az acr show `
    --name $registryName `
    --resource-group $resourceGroup `
    --query id `
    -o tsv
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($registryId)) {
    throw "Unable to resolve Azure Container Registry '$registryName'."
}

foreach ($containerAppName in @($apiContainerAppName, $webContainerAppName)) {
    $principalId = az containerapp identity show `
        --name $containerAppName `
        --resource-group $resourceGroup `
        --query principalId `
        -o tsv
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($principalId)) {
        throw "Unable to resolve managed identity principal for Container App '$containerAppName'."
    }

    for ($attempt = 1; $attempt -le 10; $attempt++) {
        $role = az role assignment list `
            --scope $registryId `
            --assignee-object-id $principalId `
            --query "[?roleDefinitionName=='AcrPull'].roleDefinitionName" `
            -o tsv 2>$null

        if ($role -match "AcrPull") {
            Write-Host "AcrPull confirmed for $containerAppName."
            break
        }

        if ($attempt -eq 10) {
            throw "AcrPull role was not visible for '$containerAppName' after waiting."
        }

        Write-Host "Waiting for AcrPull RBAC propagation for $containerAppName ($attempt/10)..."
        Start-Sleep -Seconds 30
    }
}
