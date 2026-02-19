# Vizi Installers (Windows + macOS)

## Easiest options

- From project root (`app`):
  - Windows: double-click `Install-Vizi.bat`
  - macOS: double-click `Install-Vizi.command`

## No-command-line (customer-friendly GUI)

- Windows GUI wizard:
  - `installer/windows/Install-Vizi-GUI.bat`
- macOS dialog installer:
  - `installer/macos/Install-Vizi-GUI.command`

- Or from terminal (auto-detect OS):

```bash
cd app
npm run install:easy
```

## Platform-specific docs

- Windows: `installer/windows/README.md`
- macOS: `installer/macos/README.md`
