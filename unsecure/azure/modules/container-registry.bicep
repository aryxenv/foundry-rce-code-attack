param name string
param location string
param tags object

var allTags = union(tags, { SecurityControl: 'Ignore' })

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: name
  location: location
  tags: allTags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

output registryName string = containerRegistry.name
output registryLoginServer string = containerRegistry.properties.loginServer
