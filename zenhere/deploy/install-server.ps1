<#
.SYNOPSIS
  Installs or updates ZenHere on this Windows Server. Run it again to update.

.DESCRIPTION
  Installs what is missing (Node.js 22, PostgreSQL 16, NSSM, Caddy), creates the
  database, writes backend\.env, builds the app and runs it as two Windows services:
    zenhere-api  Node.js API on 127.0.0.1:3100
    zenhere-web  Caddy: serves the web app and forwards /api to the API

  Test mode (no -Domain): http://<server address>, demo accounts and the test
  notification inbox, for the office network only. Production mode (-Domain):
  HTTPS certificate from Let's Encrypt and login with the LINE Login channel.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\deploy\install-server.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\deploy\install-server.ps1 -Domain zenhere.example.co.th
#>
param(
  [string]$Domain = '',
  [string]$Address = '',
  [int]$HttpPort = 80,
  [string]$InstallDir = 'C:\zenhere',
  [string]$LineLoginChannelId = '',
  [switch]$NoDemoData
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is very slow with the progress bar on PowerShell 5
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Step([string]$t) { Write-Host ''; Write-Host "=== $t ===" -ForegroundColor Cyan }
function Fail([string]$t) { Write-Host ''; Write-Host "[!] $t" -ForegroundColor Red; exit 1 }
function Note([string]$t) { Write-Host "    $t" }
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
function Download([string]$url, [string]$out) { Note "download $url"; Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing }
function New-Secret {
  $b = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  return ([Convert]::ToBase64String($b) -replace '[+/=]', 'x')
}
function Plain([Security.SecureString]$s) { return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)) }

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Fail 'Open PowerShell with "Run as Administrator" and run this again.' }

$Source = Split-Path -Parent $PSScriptRoot
$App = Join-Path $InstallDir 'app'
$Tools = Join-Path $InstallDir 'tools'
$Secrets = Join-Path $InstallDir 'secrets'
$Logs = Join-Path $InstallDir 'logs'
$Data = Join-Path $InstallDir 'data'
$Mode = 'test'
if ($Domain) { $Mode = 'production' }
New-Item -ItemType Directory -Force -Path $InstallDir, $Tools, $Secrets, $Logs, $Data | Out-Null
icacls $Secrets /inheritance:r /grant:r 'Administrators:(OI)(CI)F' 'SYSTEM:(OI)(CI)F' | Out-Null
Write-Host "ZenHere install: $Mode mode, into $InstallDir" -ForegroundColor Green

# ------------------------------------------------------------------ 1 Node.js
Step '1/8 Node.js 22'
Refresh-Path
$nodeOk = $false
if (Get-Command node -ErrorAction SilentlyContinue) {
  $major = [int](((node -v) -replace '^v', '').Split('.')[0])
  if ($major -ge 20) { $nodeOk = $true }
}
if (-not $nodeOk) {
  $rel = Invoke-RestMethod 'https://nodejs.org/dist/index.json' | Where-Object { $_.version -like 'v22.*' -and $_.lts } | Select-Object -First 1
  $msi = Join-Path $Tools "node-$($rel.version)-x64.msi"
  Download "https://nodejs.org/dist/$($rel.version)/node-$($rel.version)-x64.msi" $msi
  Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait
  Refresh-Path
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js did not install. Install Node.js 22 LTS from https://nodejs.org and run this again.' }
}
Note "node $(node -v)"

# ------------------------------------------------------------------ 2 PostgreSQL
Step '2/8 PostgreSQL 16'
$pgServiceName = 'postgresql-x64-16'
$pgBin = 'C:\Program Files\PostgreSQL\16\bin'
$superFile = Join-Path $Secrets 'postgres-superuser.txt'
$pgService = Get-Service -Name $pgServiceName -ErrorAction SilentlyContinue
if (-not $pgService) {
  $superPw = New-Secret
  [IO.File]::WriteAllText($superFile, $superPw)
  $exe = Join-Path $Tools 'postgresql-16-windows-x64.exe'
  if (-not (Test-Path $exe)) {
    try { Download 'https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64.exe' $exe }
    catch { Fail "Could not download PostgreSQL. Download the PostgreSQL 16 Windows installer from https://www.enterprisedb.com/downloads/postgres-postgresql-downloads, save it as $exe and run this again." }
  }
  Note 'installing PostgreSQL (a few minutes)'
  Start-Process $exe -ArgumentList @('--mode', 'unattended', '--unattendedmodeui', 'none', '--superpassword', $superPw, '--servicename', $pgServiceName, '--serverport', '5432', '--disable-components', 'pgAdmin,stackbuilder') -Wait
  $pgService = Get-Service -Name $pgServiceName -ErrorAction SilentlyContinue
  if (-not $pgService) { Fail "PostgreSQL did not install. Install PostgreSQL 16 by hand (service name $pgServiceName) and run this again." }
} elseif (-not (Test-Path $superFile)) {
  $superPw = Plain (Read-Host "PostgreSQL is already installed. Password of its 'postgres' user" -AsSecureString)
  [IO.File]::WriteAllText($superFile, $superPw)
}
$superPw = [IO.File]::ReadAllText($superFile)
if ($pgService.Status -ne 'Running') { Start-Service $pgServiceName }
$psql = Join-Path $pgBin 'psql.exe'
if (-not (Test-Path $psql)) { Fail "psql.exe not found in $pgBin" }

# ------------------------------------------------------------------ 3 database
Step '3/8 Database'
$env:PGPASSWORD = $superPw
function Psql([string]$sql, [string]$db = 'postgres') {
  $out = & $psql -h 127.0.0.1 -U postgres -d $db -v ON_ERROR_STOP=1 -tAc $sql
  if ($LASTEXITCODE -ne 0) { Fail "Database command failed (check the postgres password in $superFile): $sql" }
  return ($out | Out-String).Trim()
}
$dbPwFile = Join-Path $Secrets 'db-zenhere.txt'
if (-not (Test-Path $dbPwFile)) { [IO.File]::WriteAllText($dbPwFile, (New-Secret)) }
$dbPw = [IO.File]::ReadAllText($dbPwFile)
if (Psql "SELECT 1 FROM pg_roles WHERE rolname = 'zenhere'") {
  Psql "ALTER ROLE zenhere LOGIN PASSWORD '$dbPw'" | Out-Null
} else {
  Psql "CREATE ROLE zenhere LOGIN PASSWORD '$dbPw'" | Out-Null
}
if (-not (Psql "SELECT 1 FROM pg_database WHERE datname = 'zenhere'")) {
  Psql "CREATE DATABASE zenhere OWNER zenhere ENCODING 'UTF8' TEMPLATE template0" | Out-Null
  Note 'database zenhere created'
}
Psql 'CREATE EXTENSION IF NOT EXISTS pg_trgm' 'zenhere' | Out-Null
Psql 'CREATE EXTENSION IF NOT EXISTS pgcrypto' 'zenhere' | Out-Null
# Thai search uses trigram indexes; the database locale must treat Thai characters as letters
$thaiTrigrams = Psql "SELECT coalesce(array_length(show_trgm(U&'\0E2A\0E31\0E0D\0E0D\0E32\0E08\0E49\0E32\0E07'), 1), 0)" 'zenhere'
if ([int]$thaiTrigrams -eq 0) {
  Write-Host '    [warning] this database locale does not index Thai text: search still works but is slow on many documents.' -ForegroundColor Yellow
} else { Note "Thai text indexing OK ($thaiTrigrams trigrams)" }
Remove-Item Env:\PGPASSWORD

# ------------------------------------------------------------------ 4 files
Step '4/8 Application files'
$srcFull = (Resolve-Path $Source).Path.TrimEnd('\')
if ($srcFull -ne $App.TrimEnd('\')) {
  robocopy $srcFull $App /MIR /XD node_modules dist storage .venv __pycache__ .git /XF .env '*.bak-*' /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Fail "Copying files to $App failed (robocopy code $LASTEXITCODE)" }
  Note "copied to $App"
} else { Note 'running from the installed copy, nothing to copy' }

# ------------------------------------------------------------------ 5 settings
Step '5/8 Settings'
if ($Domain) {
  $Origin = "https://$Domain"
} else {
  if (-not $Address) {
    $Address = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.PrefixOrigin -in @('Dhcp', 'Manual') -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress
  }
  if (-not $Address) { Fail 'Could not find this server''s IP address; pass it with -Address' }
  $Origin = "http://$Address"
  if ($HttpPort -ne 80) { $Origin = "http://${Address}:$HttpPort" }
}
$backend = Join-Path $App 'backend'
$envFile = Join-Path $backend '.env'
$hasLineSecret = (Test-Path $envFile) -and (Select-String -Path $envFile -Pattern '^LINE_LOGIN_CHANNEL_SECRET=.+' -Quiet)
$lineId = $LineLoginChannelId
if ($lineId -or -not $hasLineSecret) {
  if (-not $lineId) { $lineId = Read-Host 'LINE Login Channel ID (press Enter to skip for now)' }
  if ($lineId) { $env:ZENHERE_LINE_LOGIN_SECRET = Plain (Read-Host 'LINE Login Channel secret' -AsSecureString) }
}
$nodeArgs = @('scripts\configure-env.cjs', '--mode', $Mode, '--origin', $Origin, '--db-url', "postgres://zenhere:$dbPw@127.0.0.1:5432/zenhere", '--storage-dir', (Join-Path $Data 'files'))
if ($lineId) { $nodeArgs += @('--line-login-id', $lineId) }
Push-Location $backend
& node @nodeArgs
$rc = $LASTEXITCODE
Pop-Location
Remove-Item Env:\ZENHERE_LINE_LOGIN_SECRET -ErrorAction SilentlyContinue
if ($rc -ne 0) { Fail 'Settings could not be written (see the message above).' }
icacls $envFile /inheritance:r /grant:r 'Administrators:F' 'SYSTEM:F' | Out-Null

# ------------------------------------------------------------------ 6 build
Step '6/8 Install packages and build (first time takes a few minutes)'
$svcApi = Get-Service -Name 'zenhere-api' -ErrorAction SilentlyContinue
if ($svcApi -and $svcApi.Status -eq 'Running') { Stop-Service 'zenhere-api' }
foreach ($dir in @('backend', 'frontend')) {
  Push-Location (Join-Path $App $dir)
  & npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "npm ci failed in $dir" }
  & npm run build
  if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "build failed in $dir" }
  Pop-Location
}
Push-Location $backend
& npm run migrate
if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'database migration failed' }
if ($Mode -eq 'test' -and -not $NoDemoData) { & npm run seed:demo }
Pop-Location

# ------------------------------------------------------------------ 7 services
Step '7/8 Windows services'
$nssm = Join-Path $Tools 'nssm.exe'
if (-not (Test-Path $nssm)) {
  $zip = Join-Path $Tools 'nssm.zip'
  try { Download 'https://nssm.cc/release/nssm-2.24.zip' $zip }
  catch { Fail "Could not download NSSM. Download nssm-2.24.zip from https://nssm.cc, copy win64\nssm.exe to $nssm and run this again." }
  Expand-Archive $zip -DestinationPath (Join-Path $Tools 'nssm') -Force
  Copy-Item (Join-Path $Tools 'nssm\nssm-2.24\win64\nssm.exe') $nssm
}
$caddy = Join-Path $Tools 'caddy.exe'
if (-not (Test-Path $caddy)) {
  try { Download 'https://caddyserver.com/api/download?os=windows&arch=amd64' $caddy }
  catch { Fail "Could not download Caddy. Download caddy for Windows amd64 from https://caddyserver.com/download, save it as $caddy and run this again." }
}

$web = (Join-Path $App 'frontend\dist') -replace '\\', '/'
$site = $Domain
$hsts = '		Strict-Transport-Security "max-age=31536000"'
if (-not $Domain) { $site = ":$HttpPort"; $hsts = '' }
$caddyfile = @"
{
	admin off
}
$site {
	encode gzip
	handle /api/* {
		request_body {
			max_size 60MB
		}
		reverse_proxy 127.0.0.1:3100
	}
	handle {
		root * $web
		try_files {path} /index.html
		file_server
	}
	header {
		X-Content-Type-Options nosniff
		Referrer-Policy same-origin
$hsts
	}
}
"@
$caddyPath = Join-Path $InstallDir 'Caddyfile'
[IO.File]::WriteAllText($caddyPath, $caddyfile)

$port = $HttpPort
if ($Domain) { $port = 443 }
$busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Where-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).Path -ne $caddy }
if ($busy) { Fail "Port $port is already used by another program (often IIS). Stop it, or run again with -HttpPort 8080." }

function Install-ZenService([string]$name, [string]$exe, [string]$arguments, [string]$dir, [string]$log) {
  if (Get-Service -Name $name -ErrorAction SilentlyContinue) {
    & $nssm stop $name 2>&1 | Out-Null
  } else {
    & $nssm install $name $exe 2>&1 | Out-Null
  }
  & $nssm set $name Application $exe | Out-Null
  & $nssm set $name AppParameters $arguments | Out-Null
  & $nssm set $name AppDirectory $dir | Out-Null
  & $nssm set $name Start SERVICE_AUTO_START | Out-Null
  & $nssm set $name AppExit Default Restart | Out-Null
  & $nssm set $name AppRestartDelay 5000 | Out-Null
  & $nssm set $name AppStdout (Join-Path $Logs "$log.out.log") | Out-Null
  & $nssm set $name AppStderr (Join-Path $Logs "$log.err.log") | Out-Null
  & $nssm set $name AppRotateFiles 1 | Out-Null
  & $nssm set $name AppRotateBytes 10485760 | Out-Null
  & $nssm start $name 2>&1 | Out-Null
  Note "service $name started"
}
Install-ZenService 'zenhere-api' (Get-Command node).Source 'dist\main.js' $backend 'api'
Install-ZenService 'zenhere-web' $caddy "run --config `"$caddyPath`" --adapter caddyfile" $InstallDir 'web'

# nightly backup at 02:15 (database + files, kept 30 days)
$backupPs = Join-Path $App 'deploy\backup.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$backupPs`" -InstallDir `"$InstallDir`""
$trigger = New-ScheduledTaskTrigger -Daily -At 2:15am
Register-ScheduledTask -TaskName 'ZenHere backup' -Action $action -Trigger $trigger -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Note 'nightly backup scheduled (task "ZenHere backup")'

# ------------------------------------------------------------------ 8 firewall and check
Step '8/8 Firewall and health check'
$ports = @($HttpPort)
if ($Domain) { $ports = @(80, 443) }
foreach ($p in $ports) {
  if (-not (Get-NetFirewallRule -DisplayName "ZenHere $p" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "ZenHere $p" -Direction Inbound -Protocol TCP -LocalPort $p -Action Allow | Out-Null
  }
}
$health = $null
for ($i = 0; $i -lt 30 -and -not $health; $i++) {
  try { $health = Invoke-RestMethod 'http://127.0.0.1:3100/api/health' } catch { Start-Sleep -Seconds 2 }
}
if (-not $health) { Fail "The API did not start. See $Logs\api.err.log" }
Note "API: $($health.status)"

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Green
Write-Host " ZenHere is running: $Origin" -ForegroundColor Green
Write-Host '==============================================================' -ForegroundColor Green
if ($Mode -eq 'test') {
  Write-Host ' Test mode: open the address above from any PC or phone on this network'
  Write-Host ' and pick a demo account. Do not open this port to the internet.'
}
$lineConfigured = Select-String -Path $envFile -Pattern '^LINE_LOGIN_CHANNEL_ID=(.+)$'
if ($lineConfigured) {
  Write-Host ''
  Write-Host ' LINE Developers Console > your LINE Login channel > LINE Login tab > Callback URL:'
  Write-Host "   $Origin/api/auth/line/callback" -ForegroundColor Yellow
  Write-Host ' After your first login, make yourself Super Admin:'
  Write-Host "   powershell -ExecutionPolicy Bypass -File $App\deploy\set-super-admin.ps1"
}
Write-Host ''
Write-Host " Logs: $Logs   Files: $Data   Secrets: $Secrets"
Write-Host ' Back up these folders and FILE_ENCRYPTION_KEY (in backend\.env) somewhere safe.'
Write-Host ' To update later: copy the new zenhere folder over and run this script again.'
