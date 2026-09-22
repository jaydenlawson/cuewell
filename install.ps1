$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Source = Join-Path $Root "plugin\com.cuewell.resolve"
$Dest = Join-Path $env:PROGRAMDATA "Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\com.cuewell.resolve"
$NodeSource = Join-Path $env:PROGRAMDATA "Blackmagic Design\DaVinci Resolve\Support\Developer\Workflow Integrations\Examples\SamplePlugin\WorkflowIntegration.node"

if (-not (Test-Path $Source)) {
  throw "Could not find $Source"
}

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Copy-Item -Path (Join-Path $Source "*") -Destination $Dest -Recurse -Force
$CopiedNode = Join-Path $Dest "WorkflowIntegration.node"
if (Test-Path $CopiedNode) { Remove-Item $CopiedNode -Force }
if (Test-Path $NodeSource) {
  Copy-Item $NodeSource $CopiedNode
} else {
  Write-Warning "WorkflowIntegration.node was not found. Timeline import needs the Resolve Studio developer example."
}

Write-Host "Installed Cuewell to:"
Write-Host "  $Dest"
Write-Host "Quit DaVinci Resolve Studio completely, reopen it, then choose Workspace > Workflow Integrations > Cuewell."
