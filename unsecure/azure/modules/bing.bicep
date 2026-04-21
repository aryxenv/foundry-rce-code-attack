param name string
param location string = 'global'
param tags object

var allTags = union(tags, { SecurityControl: 'Ignore' })

resource bingAccount 'Microsoft.Bing/accounts@2020-06-10' = {
  name: name
  location: location
  tags: allTags
  kind: 'Bing.Search.v7'
  sku: {
    name: 'S1'
  }
}

output endpoint string = 'https://api.bing.microsoft.com/'
output key string = bingAccount.listKeys().key1
output bingAccountName string = bingAccount.name
