targetScope = 'resourceGroup'

@description('The azd environment name used for resource naming and tagging.')
param environmentName string

@description('Short deterministic suffix shared with other resources.')
param resourceSuffix string

@description('Azure region for the Container Apps resources.')
param containerAppLocation string = resourceGroup().location

@description('Name of the shared Azure Container Registry provisioned for web, api, and hosted agents.')
param containerRegistryName string

@description('Login server of the shared Azure Container Registry.')
param containerRegistryEndpoint string

@description('Foundry AI project endpoint used by the api to invoke hosted agents.')
param projectEndpoint string

@description('Name of the Azure AI Services (Foundry) account hosting the agents.')
param aiServicesName string

@description('Tags applied to Azure resources.')
param tags object = {}

var cleanedEnvironmentName = take(replace(replace(replace(toLower(environmentName), '-', ''), '_', ''), ' ', ''), 18)
// Container Apps names are capped at 32 chars. Budget: 'ca-' (3) + '-' (1) +
// resourceSuffix (8) + '-web'/'-api' (4) = 16 fixed, leaving 16 for the env
// segment. Truncate to 14 to keep a safety margin.
var containerAppEnvSegment = take(cleanedEnvironmentName, 14)
var serviceTags = union(tags, {
  SecurityControl: 'Ignore'
  hosting: 'webslides'
})
var webServiceTags = union(serviceTags, {
  'azd-service-name': 'web'
})
var apiServiceTags = union(serviceTags, {
  'azd-service-name': 'api'
})
var acrPullRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d'
)
// Azure AI User: grants the api's managed identity permission to invoke the
// hosted Foundry agents (data-plane responses calls) at demo time.
var azureAiUserRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '53ca6127-db72-4b80-b1b0-d745d6d5456d'
)
var webContainerAppName = 'ca-${containerAppEnvSegment}-${resourceSuffix}-web'
var apiContainerAppName = 'ca-${containerAppEnvSegment}-${resourceSuffix}-api'

// Bootstrap-only image used at provision time before azd builds and pushes the
// real images. This subscription's egress to mcr.microsoft.com is blocked, so a
// Docker Hub image is used here (verified pullable by Container Apps in this env).
var placeholderImage = 'docker.io/library/nginx:alpine'

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: containerRegistryName
}

// Shared user-assigned identity for web + api. Using a user-assigned identity
// (instead of system-assigned) breaks the AcrPull chicken-and-egg deadlock:
// the identity exists independently, so AcrPull can be granted BEFORE the
// container apps are created. With a system-assigned identity the role
// assignment depends on the app's principalId, so the grant only happens after
// the app already exists - but the app's first revision needs AcrPull to
// validate the ACR registry credential, which hangs with "Operation expired".
resource appIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${cleanedEnvironmentName}-${resourceSuffix}'
  location: containerAppLocation
  tags: serviceTags
}

resource appRegistryPullAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, appIdentity.id, acrPullRoleDefinitionId)
  scope: registry
  properties: {
    roleDefinitionId: acrPullRoleDefinitionId
    principalId: appIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource aiServices 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: aiServicesName
}

// Let the api's user-assigned identity call the hosted agents' responses
// endpoints. Granted on the AI Services account so it covers every agent the
// project hosts (secure + unsecure).
resource appAgentInvokeAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(aiServices.id, appIdentity.id, azureAiUserRoleDefinitionId)
  scope: aiServices
  properties: {
    roleDefinitionId: azureAiUserRoleDefinitionId
    principalId: appIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${cleanedEnvironmentName}-${resourceSuffix}'
  location: containerAppLocation
  tags: serviceTags
  properties: {
    retentionInDays: 30
    sku: {
      name: 'PerGB2018'
    }
  }
}

resource containerEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${cleanedEnvironmentName}-${resourceSuffix}'
  location: containerAppLocation
  tags: serviceTags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

var webHostname = '${webContainerAppName}.${containerEnvironment.properties.defaultDomain}'
var apiHostname = '${apiContainerAppName}.${containerEnvironment.properties.defaultDomain}'
var webUrl = 'https://${webHostname}'
var apiUrl = 'https://${apiHostname}'

resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: webContainerAppName
  location: containerAppLocation
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${appIdentity.id}': {}
    }
  }
  tags: webServiceTags
  properties: {
    managedEnvironmentId: containerEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        allowInsecure: false
        targetPort: 8080
        transport: 'auto'
      }
      registries: [
        {
          server: containerRegistryEndpoint
          identity: appIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: placeholderImage
          env: [
            {
              name: 'VITE_SERVER_URL'
              value: apiUrl
            }
          ]
          resources: {
            cpu: json('0.5')
            memory: '1.0Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
  dependsOn: [
    appRegistryPullAccess
  ]
}

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: apiContainerAppName
  location: containerAppLocation
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${appIdentity.id}': {}
    }
  }
  tags: apiServiceTags
  properties: {
    managedEnvironmentId: containerEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        allowInsecure: false
        targetPort: 8000
        transport: 'auto'
      }
      registries: [
        {
          server: containerRegistryEndpoint
          identity: appIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: placeholderImage
          env: [
            {
              name: 'WEBSLIDES_EXPORT_ALLOWED_HOSTS'
              value: webHostname
            }
            {
              name: 'WEBSLIDES_CORS_ALLOWED_ORIGINS'
              value: webUrl
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: appIdentity.properties.clientId
            }
            {
              name: 'DEMO_AGENT_PROJECT_ENDPOINT'
              value: projectEndpoint
            }
            {
              name: 'DEMO_AGENT_NAME_UNSECURE'
              value: 'contoso-market-research'
            }
            {
              name: 'DEMO_AGENT_NAME_SECURE'
              value: 'contoso-market-research-secure'
            }
            {
              name: 'DEMO_AGENT_API_VERSION'
              value: '2025-11-15-preview'
            }
            {
              name: 'DEMO_AGENT_TIMEOUT_SECONDS'
              value: '150'
            }
          ]
          resources: {
            cpu: json('1.0')
            memory: '2.0Gi'
          }
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
  dependsOn: [
    appRegistryPullAccess
    appAgentInvokeAccess
  ]
}

output webUrl string = webUrl
output apiUrl string = apiUrl
output webHostname string = webHostname
output apiHostname string = apiHostname
output containerRegistryEndpoint string = containerRegistryEndpoint
output containerRegistryName string = containerRegistryName
output webContainerAppName string = web.name
output apiContainerAppName string = api.name
output appIdentityName string = appIdentity.name
output appIdentityPrincipalId string = appIdentity.properties.principalId
