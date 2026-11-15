# Nightly backup (scheduled by install-server.ps1): database dump + stored files, kept 30 days.
# Set -BackupDir to a NAS share (e.g. \\nas\backup\zenhere) to keep copies off this server.
param(
  [string]$InstallDir = 'C:\zenhere',
  [string]$BackupDir = '',
  [int]$KeepDays = 30
)
$ErrorActionPreference = 'Stop'
if (-not $BackupDir) { $BackupDir = Join-Path $InstallDir 'backups' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$dest = Join-Path $BackupDir $stamp
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$env:PGPASSWORD = [IO.File]::ReadAllText((Join-Path $InstallDir 'secrets\db-zenhere.txt'))
& 'C:\Program Files\PostgreSQL\16\bin\pg_dump.exe' -h 127.0.0.1 -U zenhere -F c -f (Join-Path $dest 'zenhere.dump') zenhere
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed' }
Remove-Item Env:\PGPASSWORD

robocopy (Join-Path $InstallDir 'data') (Join-Path $dest 'data') /E /R:2 /W:5 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'copying files failed' }
Copy-Item (Join-Path $InstallDir 'app\backend\.env') (Join-Path $dest 'backend.env')

Get-ChildItem $BackupDir -Directory | Where-Object { $_.CreationTime -lt (Get-Date).AddDays(-$KeepDays) } | Remove-Item -Recurse -Force
