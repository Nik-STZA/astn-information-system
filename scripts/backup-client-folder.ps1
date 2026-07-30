<#
.SYNOPSIS
Backs a client working folder up to the shared drive.

.DESCRIPTION
The client working folders under "STZA Group\Clients\" hold the engagement
audit trail: diary, open items, reconciliations, policies and correspondence.
They are not version controlled and not synced anywhere, so a disk failure
loses them. The portal mirrors the diary and open items into Cloud SQL, but
nothing else has a second copy.

Two destinations are written:

  current\    a mirror of the folder as it stands now
  snapshots\  a dated copy, one per day, so a bad edit can be recovered rather
              than faithfully mirrored over the only good version

Written as a script rather than a live sync deliberately: nothing should write
to the shared drive automatically in the middle of a close.

.PARAMETER ClientSlug
Folder name under the clients root, for example feldspar-sport-group.

.PARAMETER ClientName
Client folder name on the shared drive, for example "Feldspar Sport".

.PARAMETER DryRun
Report what would be copied and change nothing.

.EXAMPLE
.\scripts\backup-client-folder.ps1 -ClientSlug feldspar-sport-group -ClientName "Feldspar Sport" -DryRun
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ClientSlug,
  [Parameter(Mandatory = $true)][string]$ClientName,
  [string]$SourceRoot = "C:\Users\yogim\STZA Group\Clients",
  [string]$DestRoot   = "I:\Shared drives\Clients",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$source = Join-Path $SourceRoot $ClientSlug
$destBase = Join-Path (Join-Path $DestRoot $ClientName) "STZA Working Folder"
$current = Join-Path $destBase "current"
$snapshot = Join-Path $destBase (Join-Path "snapshots" (Get-Date -Format "yyyy-MM-dd"))

Write-Host "Source:   $source"
Write-Host "Mirror:   $current"
Write-Host "Snapshot: $snapshot"
Write-Host ""

if (-not (Test-Path $source)) { throw "Client folder not found: $source" }
if (-not (Test-Path $DestRoot)) { throw "Shared drive not reachable: $DestRoot" }

# Rule 1 from the Feldspar CLAUDE.md: OAuth tokens and service-account
# credentials never leave the local machine. The client working folder should
# not contain any, but this refuses to copy rather than trusting that, because
# the cost of being wrong once is a credential on a shared drive.
$secretPatterns = @(
  'xero_client_secret',
  'xero_refresh_token',
  'xero_last_access_token',
  'client_secret',
  'private_key',
  'BEGIN [A-Z ]*PRIVATE KEY'
)

Write-Host "Scanning for credentials before copying anything..."
$offenders = @()
foreach ($pattern in $secretPatterns) {
  $hits = Get-ChildItem -Path $source -Recurse -File -ErrorAction SilentlyContinue |
    Select-String -Pattern $pattern -List -ErrorAction SilentlyContinue
  foreach ($h in $hits) { $offenders += "$($h.Path)  (matched: $pattern)" }
}

if ($offenders.Count -gt 0) {
  Write-Host ""
  Write-Host "REFUSING TO COPY. Credential-like content found:" -ForegroundColor Red
  $offenders | Sort-Object -Unique | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
  Write-Host ""
  throw "Remove or relocate the above before backing this folder up."
}
Write-Host "  none found"
Write-Host ""

$fileCount = (Get-ChildItem -Path $source -Recurse -File).Count
$sizeKb = [math]::Round((Get-ChildItem -Path $source -Recurse -File |
  Measure-Object -Property Length -Sum).Sum / 1KB, 1)
Write-Host "$fileCount files, $sizeKb KB"

if ($DryRun) {
  Write-Host ""
  Write-Host "Dry run. Nothing written."
  return
}

New-Item -ItemType Directory -Force -Path $current  | Out-Null
New-Item -ItemType Directory -Force -Path $snapshot | Out-Null

# /MIR makes current an exact mirror, including deletions. That is why the
# dated snapshot exists: a mirror alone would faithfully propagate a mistake.
Write-Host ""
Write-Host "Mirroring to current..."
robocopy $source $current /MIR /R:2 /W:2 /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed mirroring to $current (exit $LASTEXITCODE)" }

Write-Host "Writing snapshot..."
robocopy $source $snapshot /E /R:2 /W:2 /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed writing $snapshot (exit $LASTEXITCODE)" }

$snapshotRoot = Join-Path $destBase "snapshots"
$kept = (Get-ChildItem -Path $snapshotRoot -Directory | Measure-Object).Count

Write-Host ""
Write-Host "Done. $fileCount files backed up. $kept dated snapshot(s) retained."

# robocopy uses low exit codes to report what it did, not whether it failed:
# 1 means files were copied. Left alone it propagates as the script's exit code
# and a scheduled task reports a successful backup as a failure. Anything at or
# above 8 is a real error and has already thrown above.
exit 0
