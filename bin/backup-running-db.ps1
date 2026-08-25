$ErrorActionPreference = 'Stop'

$backupStamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$projectRoot = Split-Path -Parent $PSScriptRoot
$backupDirectory = Join-Path $projectRoot 'backups'
$backupName = "portfolio_running_$backupStamp.dump"
$containerBackupPath = "/tmp/$backupName"
$hostBackupPath = Join-Path $backupDirectory $backupName

New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null

docker exec portfolio-postgres pg_dump `
  --username=portfolio `
  --dbname=portfolio `
  --format=custom `
  --no-owner `
  --no-privileges `
  --file=$containerBackupPath

if ($LASTEXITCODE -ne 0) {
  throw 'Failed to create a database dump inside portfolio-postgres.'
}

docker cp "portfolio-postgres:$containerBackupPath" $hostBackupPath

if ($LASTEXITCODE -ne 0) {
  throw 'The dump was created in the container but could not be copied to backups.'
}

$backupFile = Get-Item -LiteralPath $hostBackupPath
Write-Host "Database dump created: $($backupFile.FullName)"
Write-Host "Size: $($backupFile.Length) bytes"
