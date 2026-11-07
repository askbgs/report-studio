@echo off
rem ---------------------------------------------------------------------------
rem Report Studio render server as a Windows service (requires NSSM: https://nssm.cc)
rem Run from an elevated command prompt inside the render-server folder.
rem   install-windows-service.cmd  <API_KEY>  [PORT]
rem ---------------------------------------------------------------------------
setlocal
set SVC=ReportStudioRender
set KEY=%~1
set PORT=%~2
if "%KEY%"=="" (echo Usage: install-windows-service.cmd API_KEY [PORT] & exit /b 1)
if "%PORT%"=="" set PORT=3900
for /f "delims=" %%i in ('where node') do set NODE=%%i
if "%NODE%"=="" (echo node.exe not found in PATH & exit /b 1)

call npm install --omit=dev || exit /b 1

nssm install %SVC% "%NODE%" "%~dp0server.js"
nssm set %SVC% AppDirectory "%~dp0."
nssm set %SVC% AppEnvironmentExtra API_KEY=%KEY% PORT=%PORT% HOST=127.0.0.1 MAX_PAGES=4
nssm set %SVC% AppStdout "%~dp0logs\service.log"
nssm set %SVC% AppStderr "%~dp0logs\service.log"
nssm set %SVC% AppRotateFiles 1
nssm set %SVC% AppRotateBytes 10485760
nssm set %SVC% Start SERVICE_AUTO_START
if not exist "%~dp0logs" mkdir "%~dp0logs"
nssm start %SVC%
echo.
echo Service %SVC% started on port %PORT%. Test:  curl http://127.0.0.1:%PORT%/health
endlocal
