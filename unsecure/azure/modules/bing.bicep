param name string
param location string = 'global'
param tags object

var allTags = union(tags, { SecurityControl: 'Ignore' })

resource bingAccount 'Microsoft.Bing/accounts@2020-06-10' = {
  name: name
  location: location
  tags: allTags
  kind: 'Bing.Grounding'
  sku: {
    name: 'G1'
  }
}

output endpoint string = 'https://api.bing.microsoft.com/'
output key string = bingAccount.listKeys().key1
output bingAccountName string = bingAccount.name
output bingAccountId string = bingAccount.id
output bingAccountLocation string = bingAccount.location
