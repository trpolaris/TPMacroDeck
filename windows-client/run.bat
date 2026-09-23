@echo off
chcp 65001 >nul
title TP Macro Deck Client
cd /d "%~dp0"
python bridge_server.py
if errorlevel 1 (
  echo.
  echo Bridge kapandi veya hata verdi.
  pause
)
