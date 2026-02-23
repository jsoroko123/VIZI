# Mesora Installers (Windows + macOS)

## Easiest options

- From project root (`app`):
  - Windows: double-click `Install-Mesora.bat`
  - macOS: double-click `Install-Mesora.command`

## No-command-line (customer-friendly GUI)

- Windows GUI wizard:
  - `installer/windows/Install-Mesora-GUI.bat`
- macOS dialog installer:
  - `installer/macos/Install-Mesora-GUI.command`

- Or from terminal (auto-detect OS):

```bash
cd app
npm run install:easy
```

## Platform-specific docs

- Windows: `installer/windows/README.md`
- macOS: `installer/macos/README.md`
