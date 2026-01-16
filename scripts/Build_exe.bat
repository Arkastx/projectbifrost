@echo off
setlocal

set "ICON_PNG=assets\icons\statusrank\ui_statusrank_88.png"
set "ICON_ICO=assets\icons\statusrank\ui_statusrank_88.ico"
set "OUTPUT_NAME=ProjectBifrost"

where pyinstaller >nul 2>nul
if errorlevel 1 (
  echo pyinstaller not found. Run: pip install pyinstaller
  exit /b 1
)

if not exist "%ICON_ICO%" (
  where magick >nul 2>nul
  if errorlevel 1 (
    echo Icon .ico not found and ImageMagick is missing.
    echo Convert "%ICON_PNG%" to "%ICON_ICO%" and retry.
    exit /b 1
  )
  magick convert "%ICON_PNG%" "%ICON_ICO%"
)

pyinstaller --noconfirm --onefile --name "%OUTPUT_NAME%" --icon "%ICON_ICO%" --add-data "static;static" --add-data "assets;assets" main.py
endlocal
