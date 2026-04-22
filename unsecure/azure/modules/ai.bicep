param name string
param location string
param tags object
param modelName string = 'gpt-4o-mini'
param modelVersion string = '2024-07-18'
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

@description('Bing account resource ID for connection metadata.')
param bingAccountId string = ''

@description('Bing account location (typically global).')
param bingAccountLocation string = 'global'

@description('Bing API key (sourced from listKeys at deploy time).')
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
  identity: {
    type: 'SystemAssigned'
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

// Account-level capability host. Required for hosted agents — without this,
// `az cognitiveservices agent start` fails with "Capability Host not found".
// `enablePublicHostingEnvironment: true` is required for hosted agent containers
// to run in Microsoft's managed environment (vs a private network-isolated one).
// See: https://learn.microsoft.com/azure/foundry/agents/concepts/hosted-agents#create-an-account-level-capability-host
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

resource modelDeployment'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
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

// Hosted agent runtime calls POST /assistants as the project's own MI.
// Without Azure AI User on the parent account, that call returns PermissionDenied
// (missing data action Microsoft.CognitiveServices/accounts/AIServices/agents/write).
resource projectAzureAIUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: aiServices
  name: guid(aiServices.id, aiProject.id, '53ca6127-db72-4b80-b1b0-d745d6d5456d')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '53ca6127-db72-4b80-b1b0-d745d6d5456d')
    principalId: aiProject.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// --- Bing Grounding connection for agents (account-scoped, per Microsoft 45-basic-agent-bing sample) ---
resource bingConnection 'Microsoft.CognitiveServices/accounts/connections@2025-04-01-preview' = if (!empty(bingAccountName)) {
  parent: aiServices
  name: 'bing-grounding'
  dependsOn: [
    aiProject
  ]
  properties: {
    category: 'ApiKey'
    target: 'https://api.bing.microsoft.com/'
    authType: 'ApiKey'
    isSharedToAll: true
    credentials: {
      key: bingAccountKey
    }
    metadata: {
      ApiType: 'Azure'
      Location: bingAccountLocation
      ResourceId: bingAccountId
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
