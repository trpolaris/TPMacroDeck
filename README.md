# TP Macro Deck

A lightweight bridge that turns Android tablets into remote control surfaces for Macro Deck.

TP Macro Deck provides:

- Android tablet client based on WebView
- Windows bridge client
- Wi-Fi and USB/ADB connectivity
- Macro Deck WebSocket integration
- Touch, long-press and release events
- Fullscreen / kiosk-style tablet UI
- Persistent connection settings
- Isolated ADB server support for USB mode
- Android 4.2.2+ compatibility (API 17+)

## Architecture

```text
Android Tablet
      │
      ├── Wi-Fi ───────────────┐
      │                        ▼
      │                 TP Macro Deck
      │                    Bridge
      │                        │
      └── USB / ADB ───────────┤
                               ▼
                         Macro Deck
                           WebSocket
                             :8191
```

In USB mode, the bridge uses a dedicated ADB server and forwards the Android TCP service to the Windows client.

## Repository layout

```text
TPMacroDeck/
├── windows-client/       # Windows bridge and EXE packaging
│   ├── bridge_server.py
│   ├── client.js
│   ├── index.html
│   ├── style.css
│   ├── requirements.txt
│   ├── TPMacroDeckClient.spec
│   ├── adb.exe
│   ├── AdbWinApi.dll
│   └── AdbWinUsbApi.dll
│
├── android-client/       # Android WebView client
│   ├── app/
│   ├── gradle/
│   ├── build.gradle
│   └── settings.gradle
│
├── .gitignore
├── LICENSE
└── README.md
```

## Requirements

### Windows bridge

- Windows 10/11
- Python 3.x
- Macro Deck running and reachable on TCP port `8191`
- For USB mode: Android device with USB debugging enabled

Install Python dependencies:

```bat
cd windows-client
python -m pip install -r requirements.txt
```

Run from source:

```bat
python bridge_server.py
```

Or use:

```bat
run.bat
```

## Build Windows EXE

The packaging script creates a standalone Windows executable with PyInstaller:

```bat
cd windows-client
build_exe_packaging_only.bat
```

Output:

```text
dist/TPMacroDeckClient.exe
```

## Android client

The Android project targets old Android devices and currently uses:

- Minimum SDK: 17 (Android 4.2.2)
- Target SDK: 28
- Android Gradle Plugin: 7.2.0
- Gradle: 7.3.3 or compatible
- Java 8 source compatibility

Build:

```bat
cd android-client
gradle assembleDebug
```

APK output:

```text
app/build/outputs/apk/debug/app-debug.apk
```

Install with ADB:

```bat
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Connection

The Android client uses the TP bridge for its connection flow. The bridge exposes its local web service on port `8080` and connects to Macro Deck on port `8191`.

For Wi-Fi mode, enter the Windows PC IPv4 address in the Android client connection settings.

For USB mode, enable USB debugging on the Android tablet and connect it to the Windows PC. The Windows bridge uses an isolated ADB server so it does not need to take over another ADB installation.

## USB protocol

The USB transport uses newline-delimited UTF-8 JSON messages. Control messages include:

- `TP_READY`
- `TP_PING`
- `TP_PONG`
- `BUTTON_PRESS`
- `BUTTON_LONG_PRESS`
- `BUTTON_RELEASE`
- `BUTTON_LONG_PRESS_RELEASE`

## Notes

This repository contains source code and required runtime files. Generated build directories, Gradle caches, IDE metadata, local SDK paths, generated APKs and PyInstaller build output are intentionally excluded from Git.

Macro Deck is a separate project and is not included in this repository.
