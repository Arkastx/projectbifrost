# Project Bifrost

Project Bifrost reads packets from `CarrotJuicer.dll` and turns them into tangible data you can use.
Heavily inspired by https://github.com/qwcan/UmaLauncher.

## What does it do?
Reads packets from `CarrotJuicer.dll` to tangible data that you can use.

## Why is it useful?
- Helps you make a decision when training your horse
- Can port veteran umas straight to Umalator for easy comparison  
  https://kachi-dev.github.io/uma-tools/umalator-global/

## Installation

1) Install Hachimi-Edge  
https://github.com/kairusds/Hachimi-Edge  
and get a global port of Carrot Juicer.

2) Clone this repo, install requirements, and launch `main.py`.

```bash
git clone https://github.com/Arkastx/projectbifrost.git
cd projectbifrost
pip install -r requirements.txt
python main.py
```

If you do not want to build from source, grab the latest EXE from Releases.

## Build Windows EXE (PyInstaller)

This bundles the app so users can run a standalone `.exe`.

1) Install build tools:

```bash
pip install pyinstaller
```

2) The icon is already in the repo (`assets/icons/statusrank/ui_statusrank_88.ico`). If you need to re-generate it:

```bash
magick convert assets/icons/statusrank/ui_statusrank_88.png assets/icons/statusrank/ui_statusrank_88.ico
```

If you do not have ImageMagick, use any PNG-to-ICO converter and place it at `assets/icons/statusrank/ui_statusrank_88.ico`.

3) Build the executable from the `projectbifrost` folder:

```bash
scripts\\Build_exe.bat
```

Alternatively, run PyInstaller directly:

```bash
pyinstaller --noconfirm --onefile --name ProjectBifrost --icon assets/icons/statusrank/ui_statusrank_88.ico --add-data "static;static" --add-data "assets;assets" main.py
```

The executable will be in `dist/ProjectBifrost.exe`.

## Updating Umalator Assets
Umalator is vendored locally for internal simulations. To update the bundle:

```bash
# Windows (PowerShell)
./scripts/update-umalator.ps1

# macOS/Linux
./scripts/update-umalator.sh
```

## Todo
- Fix UI + better sorting for veteran horse tab
- Implement calculator  
  https://daftuyda.moe/optimizer

## How to get help
Make a ticket (TBD).

## Maintainer
Rancor ([@arkastx](https://github.com/arkastx)) ? passion project for fun currently.
