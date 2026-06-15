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

@description('Tags applied to Azure resources.')
param tags object = {}

var cleanedEnvironmentName = take(replace(replace(replace(toLower(environmentName), '-', ''), '_', ''), ' ', ''), 18)
var serviceTags = union(tags, {
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
var webContainerAppName = 'ca-${cleanedEnvironmentName}-${resourceSuffix}-web'
var apiContainerAppName = 'ca-${cleanedEnvironmentName}-${resourceSuffix}-api'

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: containerRegistryName
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
    type: 'SystemAssigned'
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
          identity: 'system'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
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
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: apiContainerAppName
  location: containerAppLocation
  identity: {
    type: 'SystemAssigned'
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
          identity: 'system'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          env: [
            {
              name: 'WEBSLIDES_EXPORT_ALLOWED_HOSTS'
              value: webHostname
            }
            {
              name: 'WEBSLIDES_CORS_ALLOWED_ORIGINS'
              value: webUrl
            }
          ]
          resources: {
            cpu: json('1.0')
            memory: '2.0Gi'
          }
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

resource webRegistryPullAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, web.name, acrPullRoleDefinitionId)
  scope: registry
  properties: {
    roleDefinitionId: acrPullRoleDefinitionId
    principalId: web.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource apiRegistryPullAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, api.name, acrPullRoleDefinitionId)
  scope: registry
  properties: {
    roleDefinitionId: acrPullRoleDefinitionId
    principalId: api.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output webUrl string = webUrl
output apiUrl string = apiUrl
output webHostname string = webHostname
output apiHostname string = apiHostname
output containerRegistryEndpoint string = containerRegistryEndpoint
output containerRegistryName string = containerRegistryName
output webContainerAppName string = web.name
output apiContainerAppName string = api.name
