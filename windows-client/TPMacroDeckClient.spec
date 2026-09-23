# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules

hiddenimports = collect_submodules("websocket")

a = Analysis(
    ["bridge_server.py"],
    pathex=["."],
    binaries=[
        ("adb.exe", "."),
        ("AdbWinApi.dll", "."),
        ("AdbWinUsbApi.dll", "."),
    ],
    datas=[
        ("index.html", "."),
        ("client.js", "."),
        ("style.css", "."),
        ("icon.ico", "."),
    ],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="TPMacroDeckClient",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    icon="icon.ico",
)
