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
# The web + api container apps share a single user-assigned identity. Confirm
# AcrPull on that one principal so azd deploy can pull the freshly pushed image.
$principalId = Get-RequiredAzdEnvValue "AZURE_APP_IDENTITY_PRINCIPAL_ID"

$registryName = $registryEndpoint.Split(".")[0]
$registryId = az acr show `
    --name $registryName `
    --resource-group $resourceGroup `
    --query id `
    -o tsv
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($registryId)) {
    throw "Unable to resolve Azure Container Registry '$registryName'."
}

for ($attempt = 1; $attempt -le 10; $attempt++) {
    $role = az role assignment list `
        --scope $registryId `
        --assignee-object-id $principalId `
        --query "[?roleDefinitionName=='AcrPull'].roleDefinitionName" `
        -o tsv 2>$null

    if ($role -match "AcrPull") {
        Write-Host "AcrPull confirmed for shared container app identity."
        break
    }

    if ($attempt -eq 10) {
        throw "AcrPull role was not visible for the shared container app identity after waiting."
    }

    Write-Host "Waiting for AcrPull RBAC propagation ($attempt/10)..."
    Start-Sleep -Seconds 30
}
