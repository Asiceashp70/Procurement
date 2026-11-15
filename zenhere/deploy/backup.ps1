# Nightly backup (Task Scheduler): pg_dump + copy of the encrypted file store to the NAS, keep 30 days.
param(
  [string]$PgBin = "C:\Program Files\PostgreSQL\16\bin",
  [string]$Storage = "C:\zenhere\backend\storage",
  [string]$Nas = "\\nas\backup\zenhere",
  [int]$KeepDays = 30
)
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$dest = Join-Path $Nas $stamp
New-Item -ItemType Directory -Force -Path $dest | Out-Null

# PGPASSWORD (or a pgpass.conf) must be set for the service account running this task
& (Join-Path $PgBin "pg_dump.exe") -h 127.0.0.1 -U zenhere -F c -f (Join-Path $dest "zenhere.dump") zenhere
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
robocopy $Storage (Join-Path $dest "storage") /E /R:2 /W:5 | Out-Null

Get-ChildItem $Nas -Directory | Where-Object { $_.CreationTime -lt (Get-Date).AddDays(-$KeepDays) } | Remove-Item -Recurse -Force
