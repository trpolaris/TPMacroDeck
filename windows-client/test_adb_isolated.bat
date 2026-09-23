@echo off
title TP Macro Deck - Isolated ADB Test
cd /d "%~dp0"

echo ==========================================
echo TP Macro Deck - Isolated ADB Test
echo ==========================================
echo.

set ADB_SERVER_SOCKET=tcp:127.0.0.1:5038
set ANDROID_ADB_SERVER_PORT=5038

echo [1] ADB server baslatiliyor...
adb.exe -P 5038 start-server

echo.
echo [2] Cihazlar:
adb.exe -P 5038 devices -l

echo.
echo [3] Port forwarding:
adb.exe -P 5038 forward tcp:18765 tcp:8765
adb.exe -P 5038 forward --list

echo.
pause
