# Post-provision hook: seeds storage + builds and deploys the hosted agent
Write-Host "Running post-provision setup..." -ForegroundColor Cyan

Push-Location $PSScriptRoot

# Add the deploying user as a PostgreSQL Entra admin so setup.py can seed data.
Write-Host "Granting PostgreSQL admin to deployer..." -ForegroundColor Cyan
$pgName = (azd env get-value POSTGRESQL_NAME)
$rg = (azd env get-value AZURE_RESOURCE_GROUP)
$upn = (az ad signed-in-user show --query userPrincipalName -o tsv)
$oid = (az ad signed-in-user show --query id -o tsv)

if ($pgName -and $rg -and $upn -and $oid) {
    az postgres flexible-server ad-admin create `
        --resource-group $rg `
        --server-name $pgName `
        --object-id $oid `
        --display-name $upn `
        --type User `
        --only-show-errors 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✅ $upn granted PG Entra admin" -ForegroundColor Green
    } else {
        Write-Host "  ⚠️  ad-admin create returned non-zero (may already exist)" -ForegroundColor Yellow
    }
} else {
    Write-Host "  ⚠️  Skipping admin grant — missing POSTGRESQL_NAME / AZURE_RESOURCE_GROUP / signed-in user" -ForegroundColor Yellow
}

# Create venv and install dependencies
uv venv --quiet
uv pip install -r requirements.txt --quiet

# Activate venv and run setup
& .\.venv\Scripts\python.exe setup.py

Pop-Location
