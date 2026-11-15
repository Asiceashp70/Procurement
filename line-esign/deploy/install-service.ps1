# Installs the API as a Windows service with NSSM (https://nssm.cc). Run as Administrator.
# The service restarts itself if it crashes. Logs go to C:\esign\logs.
param(
  [string]$Root = "C:\esign",
  [string]$Nssm = "C:\tools\nssm\nssm.exe",
  [string]$Node = (Get-Command node).Source
)

$api = Join-Path $Root "backend"
New-Item -ItemType Directory -Force -Path (Join-Path $Root "logs") | Out-Null

& $Nssm install esign-api $Node "dist\main.js"
& $Nssm set esign-api AppDirectory $api
& $Nssm set esign-api AppEnvironmentExtra "NODE_ENV=production"
& $Nssm set esign-api Start SERVICE_AUTO_START
& $Nssm set esign-api AppExit Default Restart
& $Nssm set esign-api AppRestartDelay 5000
& $Nssm set esign-api AppStdout (Join-Path $Root "logs\api.out.log")
& $Nssm set esign-api AppStderr (Join-Path $Root "logs\api.err.log")
& $Nssm set esign-api AppRotateFiles 1
& $Nssm set esign-api AppRotateBytes 10485760
& $Nssm start esign-api

Write-Host "esign-api installed. Health check: http://127.0.0.1:3100/api/health"
