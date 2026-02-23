# Mesora Windows Installer

This installer sets up Mesora and all required Node packages for:

- `app` (React + Vite UI)
- `app/opc-server` (OPC bridge)
- `app/ai-server` (AI + API server)
- PostgreSQL server (default: version 17) with a Mesora database/user

## Quick install

1. Double-click `Install-Mesora.bat`
2. Wait for package installation to complete
3. Start Mesora from the Desktop shortcut (`Mesora`) or:
   - `%LOCALAPPDATA%\Mesora\Start-Mesora.cmd`

## PowerShell usage

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-mesora.ps1
```

Useful options:

```powershell
# Custom install path
.\install-mesora.ps1 -InstallRoot "D:\Apps\Mesora"

# Skip dependency install (installer script test only)
.\install-mesora.ps1 -SkipDependencyInstall

# Skip PostgreSQL install/config
.\install-mesora.ps1 -SkipPostgresInstall

# Skip shortcut creation
.\install-mesora.ps1 -NoShortcuts

# Use npm install instead of npm ci
.\install-mesora.ps1 -UseNpmInstall

# Custom PostgreSQL settings
.\install-mesora.ps1 `
  -PostgresVersion 17 `
  -PostgresPort 5432 `
  -PostgresSuperPassword "postgres" `
  -PostgresDatabase "mesora_db" `
  -PostgresAppUser "mesora_user" `
  -PostgresAppPassword "mesora_user"

## Notes

- Requires Node.js 20+.  
  If Node is missing and `winget` is available, installer will auto-install Node LTS.
- Requires `winget` for unattended PostgreSQL installation (unless `-SkipPostgresInstall`).
- AI server settings are in:
  - `%LOCALAPPDATA%\Mesora\ai-server\.env`
- AI provider/agent configuration is in-app at:
  - `/ai-config`
- OPC server config is in:
  - `%LOCALAPPDATA%\Mesora\opc-server\config.json`
