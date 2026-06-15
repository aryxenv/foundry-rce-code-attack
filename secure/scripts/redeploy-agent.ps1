<#
.SYNOPSIS
    Rebuild + redeploy the Contoso secure hosted agent as a new version, route 100% traffic to it.

.DESCRIPTION
    Reads config from redeploy-agent.config.json (next to this script), pulls Azure
    resource names from `azd env`, runs `az acr build`, creates a new agent
    version via `az cognitiveservices agent create`, then PATCHes the agent's
    version_selector via the Foundry REST API to send 100% of traffic to the
    new version.

    Run from the `secure/` folder. The consolidated root azd environment is
    used by default; pass -AzdEnvRoot only for advanced scenarios.

.PARAMETER ProjectRoot
    Path to the secure/ folder. Defaults to the parent of this script.

.PARAMETER SkipBuild
    Reuse the most recently built image tag (read from .last_tag) instead of
    building a new one. Useful for retrying just the deploy step.

.PARAMETER Tag
    Override the image tag (default: timestamp yyyyMMdd-HHmmss).

.PARAMETER AzdEnvRoot
    Optional folder whose azd environment should be read. Use the repository
    root when this agent was provisioned by the consolidated root deployment.

.EXAMPLE
    ./scripts/redeploy-agent.ps1

.EXAMPLE
    ./scripts/redeploy-agent.ps1 -SkipBuild
#>

[CmdletBinding()]
param(
    [string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $PSCommandPath)),
    [switch]$SkipBuild,
    [string]$Tag,
    [string]$AzdEnvRoot = $env:AZD_ENV_ROOT
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "    $msg" -ForegroundColor Yellow }

function Get-AzdValue([string]$key) {
    $root = if (-not [string]::IsNullOrWhiteSpace($AzdEnvRoot)) { $AzdEnvRoot } else { (Resolve-Path (Join-Path $ProjectRoot "..")).Path }
    Push-Location $root
    try {
        $val = (azd env get-value $key 2>$null) -replace '"', ''
        if (-not $val) { throw "azd env value '$key' is empty. Run 'azd up' first." }
        return $val
    }
    finally {
        Pop-Location
    }
}

# ---------------------------------------------------------------------------
# Load config
# ---------------------------------------------------------------------------
Push-Location $ProjectRoot
try {
    $configPath = Join-Path $PSScriptRoot 'redeploy-agent.config.json'
    if (-not (Test-Path $configPath)) {
        throw "Config file not found at $configPath"
    }
    $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
    Write-Step "Loaded config from $configPath"
    Write-OK "agent: $($cfg.agentName)  image: $($cfg.imageRepo)"

    # Resolve azd env values
    $resolved = @{}
    foreach ($prop in $cfg.azdEnvVars.PSObject.Properties) {
        $resolved[$prop.Name] = Get-AzdValue $prop.Value
    }
    $resolved['modelDeploymentName'] = $cfg.modelDeploymentName

    # ---------------------------------------------------------------------
    # Build (or reuse)
    # ---------------------------------------------------------------------
    $tagFile = Join-Path $PSScriptRoot '.last_tag'
    if ($SkipBuild) {
        if (-not (Test-Path $tagFile)) { throw "-SkipBuild set but no $tagFile exists" }
        $Tag = (Get-Content $tagFile -Raw).Trim()
        Write-Step "Reusing existing image tag: $Tag"
    } else {
        if (-not $Tag) { $Tag = (Get-Date -Format "yyyyMMdd-HHmmss") }
        Write-Step "Building image $($cfg.imageRepo):$Tag in ACR $($resolved.acr)"
        $buildArgs = @(
            'acr','build',
            '--registry', $resolved.acr,
            '--image',    "$($cfg.imageRepo):$Tag",
            '--file',     $cfg.dockerfile,
            $cfg.buildContext,
            '--no-logs',
            '-o','tsv'
        )
        $buildOut = & az @buildArgs 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host ($buildOut | Out-String) -ForegroundColor Red
            throw "ACR build failed (exit $LASTEXITCODE)"
        }
        $Tag | Out-File -Encoding ascii $tagFile
        Write-OK "Build succeeded -> $($cfg.imageRepo):$Tag"
    }

    # ---------------------------------------------------------------------
    # Compose --env arg list
    # ---------------------------------------------------------------------
    $envPairs = @()
    foreach ($e in $cfg.containerEnv) {
        $val = if ($e.from) { $resolved[$e.from] } else { $resolved[$e.literal] }
        if (-not $val) { throw "Env var '$($e.name)' resolved to empty (from=$($e.from) literal=$($e.literal))" }
        $envPairs += "$($e.name)=$val"
    }

    # ---------------------------------------------------------------------
    # Create new agent version
    # ---------------------------------------------------------------------
    $imageRef = "$($resolved.acr).azurecr.io/$($cfg.imageRepo):$Tag"
    Write-Step "Creating new agent version with image $imageRef"
    $createArgs = @(
        'cognitiveservices','agent','create',
        '-a', $resolved.aiServices,
        '-p', $resolved.project,
        '-n', $cfg.agentName,
        '--image', $imageRef,
        '--env'
    ) + $envPairs + @('-o','json')
    $createOut = & az @createArgs 2>&1
    $rawOut = ($createOut | Out-String)
    $newVersion = $null

    # Extract JSON if present (may be absent on partial-failure paths).
    $idxBrace = $rawOut.IndexOf('{'); $idxBracket = $rawOut.IndexOf('[')
    if ($idxBrace -lt 0) { $jsonStart = $idxBracket }
    elseif ($idxBracket -lt 0) { $jsonStart = $idxBrace }
    else { $jsonStart = [Math]::Min($idxBrace, $idxBracket) }
    if ($jsonStart -ge 0) {
        try {
            $newAgent = $rawOut.Substring($jsonStart) | ConvertFrom-Json
            if ($newAgent.version) {
                $newVersion = [string]$newAgent.version
                Write-OK "Created version $newVersion (status=$($newAgent.status))"
            }
        } catch { }
    }

    if ($LASTEXITCODE -ne 0) {
        # Special case: version was created but container is "already exists / Running".
        # This happens on re-runs of the same image — treat as success and proceed to traffic switch.
        $m = [regex]::Match($rawOut, "Agent version '(\d+)' was created but deployment failed.*?already exists with status Running")
        if ($m.Success) {
            $newVersion = $m.Groups[1].Value
            Write-Host "WARNING: container for version $newVersion already running; reusing." -ForegroundColor Yellow
        } else {
            Write-Host $rawOut -ForegroundColor Red
            throw "agent create failed (exit $LASTEXITCODE)"
        }
    }
    if (-not $newVersion) {
        Write-Host $rawOut -ForegroundColor Red
        throw "Could not parse new version from agent create output."
    }

    # ---------------------------------------------------------------------
    # Wait for container to come up
    # ---------------------------------------------------------------------
    Write-Step "Waiting 60s for container to start..."
    Start-Sleep -Seconds 60

    $statusOut = & az cognitiveservices agent status `
        -a $resolved.aiServices -p $resolved.project -n $cfg.agentName `
        --agent-version $newVersion -o tsv 2>&1
    Write-OK ($statusOut | Out-String).Trim()

    # ---------------------------------------------------------------------
    # Route 100% traffic to new version (REST PATCH)
    # ---------------------------------------------------------------------
    Write-Step "Routing 100% traffic to version $newVersion"
    $url = "$($resolved.projectEndpoint)/agents/$($cfg.agentName)?api-version=2025-05-15-preview"
    $token = (az account get-access-token --resource https://ai.azure.com --query accessToken -o tsv)
    if (-not $token) { throw "Failed to acquire ARM token for ai.azure.com" }

    $body = @{
        agent_endpoint = @{
            version_selector = @{
                version_selection_rules = @(
                    @{ agent_version = "$newVersion"; traffic_percentage = 100; type = "FixedRatio" }
                )
            }
        }
    } | ConvertTo-Json -Depth 10 -Compress

    $headers = @{
        Authorization      = "Bearer $token"
        "Content-Type"     = "application/merge-patch+json"
        "Foundry-Features" = "HostedAgents=V1Preview"
    }
    $patchResp = Invoke-RestMethod -Uri $url -Method Patch -Headers $headers -Body $body
    $activeRule = $patchResp.agent_endpoint.version_selector.version_selection_rules | Select-Object -First 1
    if ($activeRule.agent_version -ne "$newVersion" -or $activeRule.traffic_percentage -ne 100) {
        throw "Traffic switch did not take effect. Got: $($activeRule | ConvertTo-Json -Compress)"
    }
    Write-OK "Traffic now 100% -> v$newVersion"

    Write-Host ""
    Write-Host "Done. Image: $imageRef" -ForegroundColor Green
    Write-Host "Agent version: $newVersion (running, 100% traffic)" -ForegroundColor Green
}
finally {
    Pop-Location
}
