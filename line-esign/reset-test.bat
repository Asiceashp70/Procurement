@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo This deletes ALL test data (database and stored files) and creates the demo data again.
set /p ok=Type YES to continue: 
if /i not "%ok%"=="YES" exit /b 0
docker compose exec -T db psql -U esign -d postgres -c "DROP DATABASE IF EXISTS esign WITH (FORCE)" -c "CREATE DATABASE esign OWNER esign"
if exist backend\storage rmdir /s /q backend\storage
pushd backend
call npm run build && call npm run seed:demo
popd
echo Done. Restart the "LINE e-Sign API" window if it is open.
pause
