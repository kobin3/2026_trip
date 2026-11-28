@echo off
title P'tit Boule - local server
cd /d "%~dp0.."
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8099/petanque/"
python -m http.server 8099
pause
