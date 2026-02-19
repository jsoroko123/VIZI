# Vizi macOS Installer

This installer sets up Vizi and required Node packages for:

- `app` (React + Vite UI)
- `app/opc-server` (OPC bridge)
- `app/ai-server` (AI + API server)
- PostgreSQL (optional)
- Ollama (optional)

## Quick install

1. Open Terminal
2. Run:

```bash
cd app/installer/macos
chmod +x Install-Vizi.command install-vizi-macos.sh
./Install-Vizi.command
```

Install target defaults to:

- `~/Applications/Vizi`

## Direct script usage

```bash
bash ./install-vizi-macos.sh
```

Useful options:

```bash
# Custom install path
bash ./install-vizi-macos.sh --install-root "$HOME/Vizi"

# Skip dependency install (script test only)
bash ./install-vizi-macos.sh --skip-dependency-install

# Use npm install instead of npm ci
bash ./install-vizi-macos.sh --use-npm-install

# Skip PostgreSQL install/config
bash ./install-vizi-macos.sh --skip-postgres-install

# Skip Ollama install/config
bash ./install-vizi-macos.sh --skip-ollama-install

# Pull a model and set OPENAI_MODEL
bash ./install-vizi-macos.sh --ollama-model "llama3.2"
```

## Notes

- Requires macOS with `bash`.
- If Node.js 20+ is missing and Homebrew is available, installer will install `node@20`.
- PostgreSQL is installed via Homebrew (`postgresql@17`) unless skipped.
- AI server settings are in:
  - `~/Applications/Vizi/ai-server/.env` (or your custom install root)
- OPC server config is in:
  - `~/Applications/Vizi/opc-server/config.json` (or your custom install root)
