# Makes someone Super Admin after they have logged in once. Run as Administrator.
param([string]$InstallDir = 'C:\zenhere')
$ErrorActionPreference = 'Stop'
$backend = Join-Path $InstallDir 'app\backend'
Push-Location $backend
try {
  & node scripts\super-admin.cjs
  $pick = Read-Host 'Number (or LINE userId) to make Super Admin, Enter to cancel'
  if ($pick) {
    & node scripts\super-admin.cjs --add $pick
    if ($LASTEXITCODE -eq 0) {
      & (Join-Path $InstallDir 'tools\nssm.exe') restart zenhere-api | Out-Null
      Write-Host 'Done. The API was restarted; log out and in again.'
    }
  }
} finally { Pop-Location }
