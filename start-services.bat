@echo off
echo Starting Production Management System Services...

:: This script will start the backend and frontend services.
echo 1. Starting Database and Redis via Docker...
docker compose up -d

echo Waiting for database to be ready (5 seconds)...
timeout /t 5 /nobreak

echo 2. Starting Backend API...
start "Backend Server" cmd /c "cd backend && npm run dev"

echo 3. Starting Frontend Web App...
start "Frontend Web App" cmd /c "cd frontend && npm run dev"

echo Services started! You can now run 'npm run seed' in the backend folder.
pause
