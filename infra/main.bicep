targetScope = 'subscription'

@minLength(1)
@description('The azd environment name used for resource naming and tagging.')
param environmentName string

@description('Azure region for the Container Apps hosting resources.')
param location string = 'swedencentral'

// Principal ID of the deploying user or service principal. azd injects this from AZURE_PRINCIPAL_ID.
param deployerPrincipalId string

@description('Type of the deploying principal. Use ServicePrincipal for CI / managed identity deploys, User for local azd up.')
@allowed([
  'User'
  'ServicePrincipal'
  'Group'
])
param deployerPrincipalType string = 'User'

var resourceSuffix = take(uniqueString(subscription().id, environmentName, location), 8)
var tags = {
  'azd-env-name': environmentName
  workload: 'webslides'
}

resource resourceGroup 'Microsoft.Resources/resourceGroups@2024-07-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module agentResources './modules/agent-resources.bicep' = {
  name: 'agent-resources'
  scope: resourceGroup
  params: {
    environmentName: environmentName
    resourceSuffix: resourceSuffix
    location: location
    tags: tags
    deployerPrincipalId: deployerPrincipalId
    deployerPrincipalType: deployerPrincipalType
  }
}

module hosting './modules/hosting.bicep' = {
  name: 'hosting'
  scope: resourceGroup
  params: {
    environmentName: environmentName
    resourceSuffix: resourceSuffix
    containerAppLocation: location
    containerRegistryName: agentResources.outputs.containerRegistryName
    containerRegistryEndpoint: agentResources.outputs.containerRegistryEndpoint
    projectEndpoint: agentResources.outputs.projectEndpoint
    aiServicesName: agentResources.outputs.aiServicesName
    tags: tags
  }
}

output AZURE_RESOURCE_GROUP string = resourceGroup.name
output VITE_SERVER_URL string = hosting.outputs.apiUrl
output WEBSLIDES_EXPORT_ALLOWED_HOSTS string = hosting.outputs.webHostname
output WEBSLIDES_CORS_ALLOWED_ORIGINS string = hosting.outputs.webUrl
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = agentResources.outputs.containerRegistryEndpoint
output AZURE_CONTAINER_REGISTRY_NAME string = agentResources.outputs.containerRegistryName
output AZURE_WEB_CONTAINER_APP_NAME string = hosting.outputs.webContainerAppName
output AZURE_API_CONTAINER_APP_NAME string = hosting.outputs.apiContainerAppName
output AZURE_WEB_CONTAINER_APP_HOSTNAME string = hosting.outputs.webHostname
output AZURE_API_CONTAINER_APP_HOSTNAME string = hosting.outputs.apiHostname
output AZURE_APP_IDENTITY_NAME string = hosting.outputs.appIdentityName
output AZURE_APP_IDENTITY_PRINCIPAL_ID string = hosting.outputs.appIdentityPrincipalId
output POSTGRESQL_FQDN string = agentResources.outputs.postgresqlFqdn
output POSTGRESQL_NAME string = agentResources.outputs.postgresqlName
output DATABASE_URL string = agentResources.outputs.databaseUrl
output AI_SERVICES_ENDPOINT string = agentResources.outputs.aiServicesEndpoint
output AI_SERVICES_NAME string = agentResources.outputs.aiServicesName
output PROJECT_ENDPOINT string = agentResources.outputs.projectEndpoint
output AZURE_AI_PROJECT_ENDPOINT string = agentResources.outputs.projectEndpoint
output AZURE_AIPROJECT_ENDPOINT string = agentResources.outputs.projectEndpoint
output PROJECT_NAME string = agentResources.outputs.projectName
output CHART_STORAGE_ACCOUNT string = agentResources.outputs.chartStorageAccount
output CHART_STORAGE_CONTAINER string = agentResources.outputs.chartStorageContainer
