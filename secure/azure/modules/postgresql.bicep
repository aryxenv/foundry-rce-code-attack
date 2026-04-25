param name string
param location string
param tags object

@description('Object ID of the Microsoft Entra principal to set as the PostgreSQL admin (e.g. AI Project system-assigned MI).')
param entraAdminObjectId string

@description('Display/principal name for the Entra admin (used as the PG role name).')
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

// Allow access from Azure services (the hosted agent container reaches PG via this rule).
resource allowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgresServer
  name: 'AllowAllAzureServicesAndResourcesWithinAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// Microsoft Entra admin — the AI Project's MI gets full admin so it can read all tables/views
// (intentional: demonstrates the LLM-controlled execute_code tool inheriting MI access).
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
// AAD-auth connection string — no password. The agent obtains an AAD token at runtime
// via DefaultAzureCredential and supplies it as the password to psycopg2.
output connectionString string = 'host=${postgresServer.properties.fullyQualifiedDomainName} port=5432 dbname=postgres user=${entraAdminPrincipalName} sslmode=require'
