# Installs the API as a Windows service with NSSM (https://nssm.cc). Run as Administrator.
# The service restarts itself if it crashes. Logs go to C:\zenhere\logs.
param(
  [string]$Root = "C:\zenhere",
  [string]$Nssm = "C:\tools\nssm\nssm.exe",
  [string]$Node = (Get-Command node).Source
)

$api = Join-Path $Root "backend"
New-Item -ItemType Directory -Force -Path (Join-Path $Root "logs") | Out-Null

& $Nssm install zenhere-api $Node "dist\main.js"
& $Nssm set zenhere-api AppDirectory $api
& $Nssm set zenhere-api AppEnvironmentExtra "NODE_ENV=production"
& $Nssm set zenhere-api Start SERVICE_AUTO_START
& $Nssm set zenhere-api AppExit Default Restart
& $Nssm set zenhere-api AppRestartDelay 5000
& $Nssm set zenhere-api AppStdout (Join-Path $Root "logs\api.out.log")
& $Nssm set zenhere-api AppStderr (Join-Path $Root "logs\api.err.log")
& $Nssm set zenhere-api AppRotateFiles 1
& $Nssm set zenhere-api AppRotateBytes 10485760
& $Nssm start zenhere-api

Write-Host "zenhere-api installed. Health check: http://127.0.0.1:3100/api/health"
