# Vizi Windows Installer

This installer sets up Vizi and all required Node packages for:

- `app` (React + Vite UI)
- `app/opc-server` (OPC bridge)
- `app/ai-server` (AI + API server)
- PostgreSQL server (default: version 17) with a Vizi database/user
- Ollama (local LLM runtime)

## Quick install

1. Double-click `Install-Vizi.bat`
2. Wait for package installation to complete
3. Start Vizi from the Desktop shortcut (`Vizi`) or:
   - `%LOCALAPPDATA%\Vizi\Start-Vizi.cmd`

## PowerShell usage

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-vizi.ps1
```

Useful options:

```powershell
# Custom install path
.\install-vizi.ps1 -InstallRoot "D:\Apps\Vizi"

# Skip dependency install (installer script test only)
.\install-vizi.ps1 -SkipDependencyInstall

# Skip PostgreSQL install/config
.\install-vizi.ps1 -SkipPostgresInstall

# Skip Ollama install/config
.\install-vizi.ps1 -SkipOllamaInstall

# Skip shortcut creation
.\install-vizi.ps1 -NoShortcuts

# Use npm install instead of npm ci
.\install-vizi.ps1 -UseNpmInstall

# Custom PostgreSQL settings
.\install-vizi.ps1 `
  -PostgresVersion 17 `
  -PostgresPort 5432 `
  -PostgresSuperPassword "postgres" `
  -PostgresDatabase "vizi_db" `
  -PostgresAppUser "vizi_user" `
  -PostgresAppPassword "vizi_user"

# Optional: pull an Ollama model and set OPENAI_MODEL to it
.\install-vizi.ps1 -OllamaModel "llama3.2"
```

## Notes

- Requires Node.js 20+.  
  If Node is missing and `winget` is available, installer will auto-install Node LTS.
- Requires `winget` for unattended PostgreSQL installation (unless `-SkipPostgresInstall`).
- Requires `winget` for unattended Ollama installation (unless `-SkipOllamaInstall`).
- AI server settings are in:
  - `%LOCALAPPDATA%\Vizi\ai-server\.env`
- OPC server config is in:
  - `%LOCALAPPDATA%\Vizi\opc-server\config.json`
