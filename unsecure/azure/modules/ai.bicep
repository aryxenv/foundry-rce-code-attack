param name string
param location string
param tags object
param modelName string = 'gpt-4o'
param modelVersion string = '2024-11-20'
param projectName string = ''
param deployerPrincipalId string

@description('Type of the deployer principal. Use ServicePrincipal for CI / managed identity deploys.')
@allowed([
  'User'
  'ServicePrincipal'
  'Group'
])
param deployerPrincipalType string = 'User'

param bingAccountName string = ''

@secure()
param bingAccountKey string = ''

var allTags = union(tags, { SecurityControl: 'Ignore' })
var aiProjectName = !empty(projectName) ? projectName : '${name}-project'

resource aiServices 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: name
  location: location
  tags: allTags
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  properties: {
    allowProjectManagement: true
    customSubDomainName: name
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

resource capabilityHost 'Microsoft.CognitiveServices/accounts/capabilityHosts@2025-10-01-preview' = {
  parent: aiServices
  name: 'accountcaphost'
  properties: {
    capabilityHostKind: 'Agents'
    enablePublicHostingEnvironment: true
  }
  dependsOn: [aiProject]
}

resource modelDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: aiServices
  name: modelName
  sku: {
    name: 'GlobalStandard'
    capacity: 50
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: modelName
      version: modelVersion
    }
  }
}

// --- RBAC: Deployer needs these roles to create/manage hosted agents and use models ---
// See TROUBLESHOOTING.md for details on these role requirements.

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

// --- Bing Grounding connection for agents ---
resource bingConnection 'Microsoft.CognitiveServices/accounts/connections@2025-04-01-preview' = if (!empty(bingAccountName)) {
  parent: aiServices
  name: 'bing-grounding'
  properties: {
    category: 'BingGrounding'
    authType: 'ApiKey'
    target: 'https://api.bing.microsoft.com/'
    isSharedToAll: true
    credentials: {
      key: bingAccountKey
    }
    metadata: {
      ApiType: 'Bing'
    }
  }
}

output aiServicesEndpoint string = aiServices.properties.endpoint
output aiServicesName string = aiServices.name
output aiServicesId string = aiServices.id
output projectEndpoint string = 'https://${name}.services.ai.azure.com/api/projects/${aiProjectName}'
output projectName string = aiProject.name
output projectPrincipalId string = aiProject.identity.principalId
output projectPrincipalName string = aiProject.name
