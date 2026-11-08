@echo off
cd /d "%~dp0site"
py -m http.server 8000 --bind 127.0.0.1
pause
