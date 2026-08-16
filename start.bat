@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem 如果想用環境變數帶金鑰，把下面這行前面的 rem 拿掉並填入金鑰
rem set NEXON_API_KEY=live_xxxxxxxxxxxxxxxx

python server.py %*
pause
