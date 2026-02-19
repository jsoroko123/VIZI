#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="${HOME}/Applications/Vizi"
SOURCE_ROOT=""
SKIP_NODE_INSTALL=0
SKIP_POSTGRES_INSTALL=0
SKIP_OLLAMA_INSTALL=0
SKIP_DEPENDENCY_INSTALL=0
USE_NPM_INSTALL=0
POSTGRES_VERSION="17"
POSTGRES_PORT="5432"
POSTGRES_SUPER_USER="postgres"
POSTGRES_SUPER_PASSWORD="postgres"
POSTGRES_DATABASE="vizi_db"
POSTGRES_APP_USER="vizi_user"
POSTGRES_APP_PASSWORD="vizi_user"
OLLAMA_MODEL=""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_SOURCE_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

log_step() {
  echo
  echo "==> $1"
}

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Options:
  --install-root PATH
  --source-root PATH
  --skip-node-install
  --skip-postgres-install
  --skip-ollama-install
  --skip-dependency-install
  --use-npm-install
  --postgres-version N
  --postgres-port N
  --postgres-super-user USER
  --postgres-super-password PASS
  --postgres-database NAME
  --postgres-app-user USER
  --postgres-app-password PASS
  --ollama-model NAME
  --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-root) INSTALL_ROOT="$2"; shift 2 ;;
    --source-root) SOURCE_ROOT="$2"; shift 2 ;;
    --skip-node-install) SKIP_NODE_INSTALL=1; shift ;;
    --skip-postgres-install) SKIP_POSTGRES_INSTALL=1; shift ;;
    --skip-ollama-install) SKIP_OLLAMA_INSTALL=1; shift ;;
    --skip-dependency-install) SKIP_DEPENDENCY_INSTALL=1; shift ;;
    --use-npm-install) USE_NPM_INSTALL=1; shift ;;
    --postgres-version) POSTGRES_VERSION="$2"; shift 2 ;;
    --postgres-port) POSTGRES_PORT="$2"; shift 2 ;;
    --postgres-super-user) POSTGRES_SUPER_USER="$2"; shift 2 ;;
    --postgres-super-password) POSTGRES_SUPER_PASSWORD="$2"; shift 2 ;;
    --postgres-database) POSTGRES_DATABASE="$2"; shift 2 ;;
    --postgres-app-user) POSTGRES_APP_USER="$2"; shift 2 ;;
    --postgres-app-password) POSTGRES_APP_PASSWORD="$2"; shift 2 ;;
    --ollama-model) OLLAMA_MODEL="$2"; shift 2 ;;
    --help) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
done

if [[ -z "${SOURCE_ROOT}" ]]; then
  SOURCE_ROOT="${DEFAULT_SOURCE_ROOT}"
fi

SOURCE_ROOT="$(cd "${SOURCE_ROOT}" && pwd)"
INSTALL_ROOT="${INSTALL_ROOT/#\~/$HOME}"

echo "Vizi macOS installer starting..."
echo "Source:  ${SOURCE_ROOT}"
echo "Install: ${INSTALL_ROOT}"

ensure_brew() {
  if has_cmd brew; then
    return
  fi
  fail "Homebrew not found. Install Homebrew first: https://brew.sh"
}

ensure_node() {
  local has_ok_node=0
  if has_cmd node; then
    local version
    version="$(node -v 2>/dev/null || true)"
    local major
    major="$(echo "${version}" | sed -E 's/^v([0-9]+).*/\1/')"
    if [[ "${major}" =~ ^[0-9]+$ ]] && [[ "${major}" -ge 20 ]]; then
      has_ok_node=1
      echo "Node.js detected: ${version}"
    fi
  fi

  if [[ "${has_ok_node}" -eq 1 ]]; then
    return
  fi

  if [[ "${SKIP_NODE_INSTALL}" -eq 1 ]]; then
    fail "Node.js 20+ is required. Install Node and rerun."
  fi

  ensure_brew
  log_step "Installing Node.js 20 via Homebrew"
  brew install node@20
  if [[ -x "/opt/homebrew/opt/node@20/bin/node" ]]; then
    export PATH="/opt/homebrew/opt/node@20/bin:${PATH}"
  elif [[ -x "/usr/local/opt/node@20/bin/node" ]]; then
    export PATH="/usr/local/opt/node@20/bin:${PATH}"
  fi

  has_cmd node || fail "node still not found after install."
}

copy_app_tree() {
  log_step "Copying application files"
  mkdir -p "${INSTALL_ROOT}"
  rsync -a --delete \
    --exclude ".git" \
    --exclude "node_modules" \
    --exclude "dist" \
    --exclude ".vite" \
    --exclude "*.log" \
    "${SOURCE_ROOT}/" "${INSTALL_ROOT}/"
}

ensure_config_files() {
  local ai_env="${INSTALL_ROOT}/ai-server/.env"
  local ai_env_example="${INSTALL_ROOT}/ai-server/.env.example"
  if [[ ! -f "${ai_env}" && -f "${ai_env_example}" ]]; then
    cp "${ai_env_example}" "${ai_env}"
  fi

  local opc_cfg="${INSTALL_ROOT}/opc-server/config.json"
  local opc_cfg_example="${INSTALL_ROOT}/opc-server/config.example.json"
  if [[ ! -f "${opc_cfg}" && -f "${opc_cfg_example}" ]]; then
    cp "${opc_cfg_example}" "${opc_cfg}"
  fi
}

upsert_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  [[ -f "${file}" ]] || return 0

  local tmp
  tmp="$(mktemp)"
  if grep -qE "^${key}=" "${file}"; then
    awk -v k="${key}" -v v="${value}" '
      BEGIN { done=0 }
      $0 ~ ("^" k "=") { print k "=" v; done=1; next }
      { print }
      END { if (!done) print k "=" v }
    ' "${file}" > "${tmp}"
  else
    cat "${file}" > "${tmp}"
    printf "\n%s=%s\n" "${key}" "${value}" >> "${tmp}"
  fi
  mv "${tmp}" "${file}"
}

ensure_postgres() {
  [[ "${SKIP_POSTGRES_INSTALL}" -eq 1 ]] && return 0
  ensure_brew

  log_step "Installing PostgreSQL ${POSTGRES_VERSION} via Homebrew"
  brew install "postgresql@${POSTGRES_VERSION}" || true
  brew services start "postgresql@${POSTGRES_VERSION}" || true

  has_cmd psql || fail "psql not found after PostgreSQL install."

  log_step "Configuring PostgreSQL database/user"
  export PGPASSWORD="${POSTGRES_SUPER_PASSWORD}"

  psql -h localhost -p "${POSTGRES_PORT}" -U "${POSTGRES_SUPER_USER}" -d postgres -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${POSTGRES_APP_USER}') THEN
    CREATE ROLE "${POSTGRES_APP_USER}" LOGIN PASSWORD '${POSTGRES_APP_PASSWORD}';
  ELSE
    ALTER ROLE "${POSTGRES_APP_USER}" WITH LOGIN PASSWORD '${POSTGRES_APP_PASSWORD}';
  END IF;
END
\$\$;
SQL

  psql -h localhost -p "${POSTGRES_PORT}" -U "${POSTGRES_SUPER_USER}" -d postgres -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${POSTGRES_DATABASE}') THEN
    CREATE DATABASE "${POSTGRES_DATABASE}" OWNER "${POSTGRES_APP_USER}";
  END IF;
END
\$\$;
SQL

  local ai_env="${INSTALL_ROOT}/ai-server/.env"
  local encoded_user encoded_pass db_url
  encoded_user="$(python3 -c "import urllib.parse; print(urllib.parse.quote('${POSTGRES_APP_USER}'))")"
  encoded_pass="$(python3 -c "import urllib.parse; print(urllib.parse.quote('${POSTGRES_APP_PASSWORD}'))")"
  db_url="postgres://${encoded_user}:${encoded_pass}@localhost:${POSTGRES_PORT}/${POSTGRES_DATABASE}"
  upsert_env "${ai_env}" "DATABASE_URL" "${db_url}"
}

ensure_ollama() {
  [[ "${SKIP_OLLAMA_INSTALL}" -eq 1 ]] && return 0
  ensure_brew

  log_step "Installing Ollama via Homebrew"
  brew install ollama || true
  brew services start ollama || true

  if has_cmd ollama && [[ -n "${OLLAMA_MODEL}" ]]; then
    log_step "Pulling Ollama model: ${OLLAMA_MODEL}"
    ollama pull "${OLLAMA_MODEL}"
  fi

  local ai_env="${INSTALL_ROOT}/ai-server/.env"
  upsert_env "${ai_env}" "OLLAMA_NATIVE_URL" "http://localhost:11434"
  if [[ -n "${OLLAMA_MODEL}" ]]; then
    upsert_env "${ai_env}" "OPENAI_MODEL" "${OLLAMA_MODEL}"
  fi
}

install_dependencies() {
  [[ "${SKIP_DEPENDENCY_INSTALL}" -eq 1 ]] && return 0

  local npm_args=("ci")
  if [[ "${USE_NPM_INSTALL}" -eq 1 ]]; then
    npm_args=("install")
  fi

  log_step "Installing root dependencies (npm ${npm_args[*]})"
  (cd "${INSTALL_ROOT}" && npm "${npm_args[@]}")

  log_step "Installing OPC server dependencies (npm ${npm_args[*]})"
  (cd "${INSTALL_ROOT}/opc-server" && npm "${npm_args[@]}")

  log_step "Installing AI server dependencies (npm ${npm_args[*]})"
  (cd "${INSTALL_ROOT}/ai-server" && npm "${npm_args[@]}")
}

write_launchers() {
  local start_path="${INSTALL_ROOT}/Start-Vizi.command"
  local stop_path="${INSTALL_ROOT}/Stop-Vizi.command"

  cat > "${start_path}" <<EOF
#!/bin/bash
set -euo pipefail
cd "${INSTALL_ROOT}"
npm run dev
EOF

  cat > "${stop_path}" <<EOF
#!/bin/bash
set -euo pipefail
pkill -f "${INSTALL_ROOT}.*(start-all\\.js|watchdog\\.js|server\\.js|vite)" || true
echo "Vizi processes stopped."
EOF

  chmod +x "${start_path}" "${stop_path}"

  echo
  echo "Start Vizi with:"
  echo "  ${start_path}"
}

ensure_node
copy_app_tree
ensure_config_files
ensure_postgres
ensure_ollama
install_dependencies
write_launchers

log_step "Install complete"
