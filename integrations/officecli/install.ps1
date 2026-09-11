<#
.SYNOPSIS
  Thin launcher for the claude-mem <-> OfficeCLI bridge installer (Windows).

.DESCRIPTION
  All logic lives in scripts/install.mjs so this and install.sh cannot drift.
  Remember that on Windows claude-mem resolves its worker port from a
  substituted uid of 77, i.e. port 37777, because process.getuid does not
  exist there.

.EXAMPLE
  .\install.ps1 -Target 'C:\AI projects\OfficeCLI' -Project officecli
#>
[CmdletBinding()]
param(
    [string]$Target = (Get-Location).Path,
    [string]$Project = 'officecli',
    [switch]$NoImport,
    [switch]$NoCheck
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Error 'node not found on PATH. claude-mem requires Node >= 20.12; install it and re-run.'
    exit 1
}

$argsList = @(
    (Join-Path $here 'scripts\install.mjs')
    '--target'; $Target
    '--project'; $Project
)
if ($NoImport) { $argsList += '--no-import' }
if ($NoCheck) { $argsList += '--no-check' }

& $node.Source @argsList
exit $LASTEXITCODE
