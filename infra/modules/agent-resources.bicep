targetScope = 'resourceGroup'

@description('The azd environment name used for resource naming and tagging.')
param environmentName string

@description('Short deterministic suffix shared with the hosting module.')
param resourceSuffix string

@description('Azure region for shared hosted-agent resources.')
param location string = resourceGroup().location

@description('Tags applied to Azure resources.')
param tags object = {}

// Principal ID of the deploying user or service principal. azd injects this from AZURE_PRINCIPAL_ID.
param deployerPrincipalId string

@description('Type of the deployer principal. Use ServicePrincipal for CI / managed identity deploys.')
@allowed([
  'User'
  'ServicePrincipal'
  'Group'
])
param deployerPrincipalType string = 'User'

@description('Model deployment name used by both hosted agents.')
param modelName string = 'gpt-4o-mini'

@description('Model version used by the shared AI Services deployment.')
param modelVersion string = '2024-07-18'

@description('Blob container used by both agents for generated chart artifacts.')
param chartStorageContainerName string = 'chart-uploads'

var cleanedEnvironmentName = take(replace(replace(replace(toLower(environmentName), '-', ''), '_', ''), ' ', ''), 18)
var allTags = union(tags, {
  SecurityControl: 'Ignore'
  agentResources: 'contoso-market-research'
})
var registryName = 'acr${cleanedEnvironmentName}${resourceSuffix}'
var aiServicesName = '${cleanedEnvironmentName}-${resourceSuffix}-ai'
var aiProjectName = '${aiServicesName}-project'
var postgresqlName = take('pg${cleanedEnvironmentName}${resourceSuffix}', 63)
var storageAccountName = take('st${cleanedEnvironmentName}${resourceSuffix}', 24)
var acrPullRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  tags: allTags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource aiServices 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: aiServicesName
  location: location
  tags: allTags
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    allowProjectManagement: true
    customSubDomainName: aiServicesName
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false
  }
}

resource aiProject 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' = {
  parent: aiServices
  name: aiProjectName
  location: location
  tags: allTags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {}
}

resource accountCapabilityHost 'Microsoft.CognitiveServices/accounts/capabilityHosts@2025-10-01-preview' = {
  parent: aiServices
  name: 'accountcaphost'
  properties: {
    capabilityHostKind: 'Agents'
    enablePublicHostingEnvironment: true
  }
  dependsOn: [
    aiProject
  ]
}

resource modelDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: aiServices
  name: modelName
  sku: {
    name: 'GlobalStandard'
    capacity: 500
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: modelName
      version: modelVersion
    }
  }
}

module postgresql './postgresql.bicep' = {
  name: 'postgresql'
  params: {
    name: postgresqlName
    location: location
    tags: allTags
    entraAdminObjectId: aiProject.identity.principalId
    entraAdminPrincipalName: aiProject.name
    entraAdminPrincipalType: 'ServicePrincipal'
  }
}

module storage './storage.bicep' = {
  name: 'chart-storage'
  params: {
    name: storageAccountName
    location: location
    tags: allTags
    principalId: aiProject.identity.principalId
    containerName: chartStorageContainerName
  }
}

resource azureAIDeveloperRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: aiServices
  name: guid(aiServices.id, deployerPrincipalId, '64702f94-c441-49e6-a78b-ef80e0188fee')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '64702f94-c441-49e6-a78b-ef80e0188fee')
    principalId: deployerPrincipalId
    principalType: deployerPrincipalType
  }
}

resource cognitiveServicesOpenAIUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: aiServices
  name: guid(aiServices.id, deployerPrincipalId, '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd')
    principalId: deployerPrincipalId
    principalType: deployerPrincipalType
  }
}

resource cognitiveServicesUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: aiServices
  name: guid(aiServices.id, deployerPrincipalId, 'a97b65f3-24c7-4388-baec-2e87135dc908')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'a97b65f3-24c7-4388-baec-2e87135dc908')
    principalId: deployerPrincipalId
    principalType: deployerPrincipalType
  }
}

resource projectAzureAIUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: aiServices
  name: guid(aiServices.id, aiProject.id, '53ca6127-db72-4b80-b1b0-d745d6d5456d')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '53ca6127-db72-4b80-b1b0-d745d6d5456d')
    principalId: aiProject.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource deployerAzureAIUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: aiServices
  name: guid(aiServices.id, deployerPrincipalId, '53ca6127-db72-4b80-b1b0-d745d6d5456d')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '53ca6127-db72-4b80-b1b0-d745d6d5456d')
    principalId: deployerPrincipalId
    principalType: deployerPrincipalType
  }
}

resource agentRegistryPullAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, aiProject.id, acrPullRoleDefinitionId)
  properties: {
    roleDefinitionId: acrPullRoleDefinitionId
    principalId: aiProject.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output containerRegistryName string = registry.name
output containerRegistryEndpoint string = registry.properties.loginServer
output postgresqlFqdn string = postgresql.outputs.fqdn
output postgresqlName string = postgresqlName
output databaseUrl string = postgresql.outputs.connectionString
output aiServicesEndpoint string = aiServices.properties.endpoint
output aiServicesName string = aiServices.name
output projectEndpoint string = 'https://${aiServicesName}.services.ai.azure.com/api/projects/${aiProjectName}'
output projectName string = aiProject.name
output chartStorageAccount string = storage.outputs.storageAccountName
output chartStorageContainer string = storage.outputs.containerName
