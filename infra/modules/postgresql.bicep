targetScope = 'resourceGroup'

param name string
param location string
param tags object

@description('Object ID of the Microsoft Entra principal to set as the PostgreSQL admin, such as the AI Project system-assigned managed identity.')
param entraAdminObjectId string

@description('Display/principal name for the Entra admin, used as the PostgreSQL role name.')
param entraAdminPrincipalName string

@description('Type of the Entra admin principal.')
@allowed([
  'ServicePrincipal'
  'User'
  'Group'
])
param entraAdminPrincipalType string = 'ServicePrincipal'

var allTags = union(tags, { SecurityControl: 'Ignore' })

resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: name
  location: location
  tags: allTags
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    version: '16'
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: subscription().tenantId
    }
    storage: {
      storageSizeGB: 32
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
  }
}

resource allowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgresServer
  name: 'AllowAllAzureServicesAndResourcesWithinAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource entraAdmin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2024-08-01' = {
  parent: postgresServer
  name: entraAdminObjectId
  properties: {
    principalType: entraAdminPrincipalType
    principalName: entraAdminPrincipalName
    tenantId: subscription().tenantId
  }
  dependsOn: [
    allowAzureServices
  ]
}

output fqdn string = postgresServer.properties.fullyQualifiedDomainName
output connectionString string = 'host=${postgresServer.properties.fullyQualifiedDomainName} port=5432 dbname=postgres user=${entraAdminPrincipalName} sslmode=require'
