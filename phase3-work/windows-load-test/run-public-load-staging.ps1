param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('YES')]
  [string]$ConfirmCloudflareQuota,
  [ValidateRange(30, 1800)]
  [int]$Final70Seconds = 300
)

$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node -CommandType Application -ErrorAction Stop
$nodeVersionText = & $nodeCommand.Source -p 'process.versions.node'
$nodeVersion = [version]$nodeVersionText
if ($nodeVersion -lt [version]'24.7.0') {
  throw 'Install Node.js 24.7 or newer before running the staging load test.'
}

$runner = Join-Path $PSScriptRoot 'public-load-staging.mjs'
if (-not (Test-Path $runner)) {
  throw 'public-load-staging.mjs must be in the same folder as this script.'
}

$env:ITK_LOAD_ACK = 'STAGING_ONLY'
$env:CF_QUOTA_CHECKED = 'YES'
$env:PUBLIC_LOAD_DURATION_SECONDS = [string]$Final70Seconds

Write-Host 'Target: https://game-staging.itkvn.workers.dev'
Write-Host 'Final 70-client phase: ' $Final70Seconds ' seconds'
Write-Host 'The report contains aggregate metrics only; it never writes cookies or answers.'
& $nodeCommand.Source $runner
exit $LASTEXITCODE
