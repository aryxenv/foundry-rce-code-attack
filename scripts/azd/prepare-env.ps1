$ErrorActionPreference = "Stop"

function Set-DefaultAzdEnvValue {
    param(
        [string] $Name,
        [string] $Value
    )

    $existing = azd env get-value $Name 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($existing)) {
        azd env set $Name $Value | Out-Null
        Write-Host "Set $Name to $Value."
        return
    }

    Write-Host "Using existing $Name=$existing."
}

Set-DefaultAzdEnvValue "AZURE_LOCATION" "swedencentral"
