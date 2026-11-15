@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title LINE e-Sign test

where node >nul 2>nul || (echo [!] Node.js is not installed. Install Node.js 22 LTS from https://nodejs.org & pause & exit /b 1)

echo === 1/5 Start PostgreSQL (Docker) ===
docker compose up -d --wait
if errorlevel 1 (
  echo [!] Docker is not running. Start Docker Desktop, or install PostgreSQL 16 and set DATABASE_URL in backend\.env
  pause
  exit /b 1
)

echo === 2/5 Settings ===
node scripts\setup-env.mjs

echo === 3/5 Install and build (first time takes a few minutes) ===
if not exist backend\node_modules (pushd backend & call npm ci & popd)
if not exist frontend\node_modules (pushd frontend & call npm ci & popd)
pushd backend
call npm run build || (popd & pause & exit /b 1)
node scripts\wait-db.cjs || (popd & pause & exit /b 1)

echo === 4/5 Demo data ===
call npm run seed:demo
popd

echo === 5/5 Start ===
start "LINE e-Sign API" cmd /k "cd /d %~dp0backend && npm start"
start "LINE e-Sign Web" cmd /k "cd /d %~dp0frontend && npm run dev -- --host"
timeout /t 6 /nobreak >nul
start http://localhost:5173
echo.
echo Open http://localhost:5173 and pick a demo account.
echo From a phone on the same Wi-Fi, open the "Network" address shown in the "LINE e-Sign Web" window.
echo Close the two windows to stop. Run reset-test.bat to start over with fresh demo data.
pause
