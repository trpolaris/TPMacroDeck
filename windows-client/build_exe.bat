@echo off
chcp 65001 >nul
title TP Macro Deck EXE Builder
cd /d "%~dp0"

echo ==========================================
echo       TP Macro Deck EXE Builder
echo ==========================================
echo.

python -m pip install -r requirements.txt
if errorlevel 1 goto :error

if exist build rmdir /s /q build
if exist dist rmdir /s /q dist

python -m PyInstaller --clean TPMacroDeckClient.spec
if errorlevel 1 goto :error

echo.
echo ==========================================
echo EXE OLUSTURULDU
echo ==========================================
echo dist\TPMacroDeckClient.exe
echo.
pause
exit /b 0

:error
echo.
echo [HATA] EXE olusturulamadi.
pause
exit /b 1
