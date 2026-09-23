@echo off
cd /d "%~dp0"
where gradle >nul 2>nul
if errorlevel 1 (
  echo Gradle bulunamadi. Android Studio veya Gradle 7.3.3+ kurun.
  pause
  exit /b 1
)
gradle assembleDebug
if errorlevel 1 (
  echo.
  echo [HATA] APK build basarisiz.
  pause
  exit /b 1
)
echo.
echo APK hazir: app\build\outputs\apk\debug\app-debug.apk
pause
