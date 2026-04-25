targetScope = 'resourceGroup'

@minLength(1)
@maxLength(64)
param environmentName string

@minLength(1)
param location string

// Principal ID of the deploying user — azd injects this automatically
param deployerPrincipalId string

@description('Type of the deploying principal. Use ServicePrincipal for CI / managed identity deploys, User for local azd up.')
@allowed([
  'User'
  'ServicePrincipal'
  'Group'
])
param deployerPrincipalType string = 'User'

var resourceToken = toLower(uniqueString(resourceGroup().id))
var tags = {
  'azd-env-name': environmentName
}

// Cap the env-name prefix so concatenated names stay within service limits
// (ACR <= 50 chars, PG flexible server <= 63 chars).
var envPrefix = take(replace(toLower(environmentName), '-', ''), 12)
var acrName = '${envPrefix}${take(resourceToken, 6)}'
var pgName = '${envPrefix}pg${take(resourceToken, 6)}'
// Storage account names: 3-24 lowercase alphanumeric only.
var storageName = take('${envPrefix}st${resourceToken}', 24)

// --- Modules ---

module containerRegistry 'modules/container-registry.bicep' = {
  name: 'container-registry'
  params: {
    name: acrName
    location: location
    tags: tags
  }
}

module ai 'modules/ai.bicep' = {
  name: 'ai'
  params: {
    name: '${environmentName}-ai'
    location: location
    tags: tags
    deployerPrincipalId: deployerPrincipalId
    deployerPrincipalType: deployerPrincipalType
  }
}

// PostgreSQL must be created AFTER the AI Project so we can set the project's MI as the Entra admin.
module postgresql 'modules/postgresql.bicep' = {
  name: 'postgresql'
  params: {
    name: pgName
    location: location
    tags: tags
    entraAdminObjectId: ai.outputs.projectPrincipalId
    entraAdminPrincipalName: ai.outputs.projectPrincipalName
    entraAdminPrincipalType: 'ServicePrincipal'
  }
}

// Storage account for hosted-agent chart uploads (replaces base64 inlining).
module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    name: storageName
    location: location
    tags: tags
    principalId: ai.outputs.projectPrincipalId
  }
}

// --- AcrPull role for AI Project identity (hosted agent image pull) ---

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
  dependsOn: [
    containerRegistry
  ]
}

resource acrPullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(acr.id, environmentName, 'acrpull-project')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: ai.outputs.projectPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// --- Outputs for azd and post-deploy scripts ---

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = containerRegistry.outputs.registryLoginServer
output AZURE_CONTAINER_REGISTRY_NAME string = acrName
output POSTGRESQL_FQDN string = postgresql.outputs.fqdn
output POSTGRESQL_NAME string = pgName
// AAD-auth connection string — agent acquires token via DefaultAzureCredential at runtime.
output DATABASE_URL string = postgresql.outputs.connectionString
output AI_SERVICES_ENDPOINT string = ai.outputs.aiServicesEndpoint
output AI_SERVICES_NAME string = ai.outputs.aiServicesName
output PROJECT_ENDPOINT string = ai.outputs.projectEndpoint
output PROJECT_NAME string = ai.outputs.projectName
output CHART_STORAGE_ACCOUNT string = storage.outputs.storageAccountName
output CHART_STORAGE_CONTAINER string = storage.outputs.containerName
