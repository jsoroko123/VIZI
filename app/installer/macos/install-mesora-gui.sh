#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_SCRIPT="${SCRIPT_DIR}/install-mesora-macos.sh"

if [[ ! -f "${INSTALL_SCRIPT}" ]]; then
  INSTALL_SCRIPT="${SCRIPT_DIR}/install-vizi-macos.sh"
fi

if [[ ! -f "${INSTALL_SCRIPT}" ]]; then
  osascript -e 'display dialog "Installation failed:\nInstaller script not found." buttons {"OK"} default button "OK"'
  exit 1
fi

CONFIG_TEXT="$(osascript <<'APPLESCRIPT'
set defaultFolder to (do shell script "echo $HOME") & "/Applications/Mesora"
set defaultConfig to "install_root=" & defaultFolder & return & ¬
  "install_postgres=yes" & return & ¬
  "postgres_super_user=postgres" & return & ¬
  "postgres_super_password=postgres" & return & ¬
  "install_ollama=yes"
set promptText to "Mesora Installer Configuration" & return & return & ¬
  "Edit values below, then click Install." & return & ¬
  "Use yes/no for install_postgres and install_ollama."
set dlg to display dialog promptText default answer defaultConfig buttons {"Cancel", "Install"} default button "Install"
return text returned of dlg
APPLESCRIPT
)"

get_key() {
  local key="$1"
  local default_value="$2"
  local value
  value="$(printf '%s\n' "${CONFIG_TEXT}" | awk -F'=' -v k="${key}" '$1==k{print substr($0,length(k)+2)}' | tail -n1)"
  if [[ -z "${value}" ]]; then
    printf '%s' "${default_value}"
  else
    printf '%s' "${value}"
  fi
}

to_bool() {
  local v
  v="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | xargs)"
  if [[ "${v}" == "1" || "${v}" == "true" || "${v}" == "yes" || "${v}" == "y" ]]; then
    echo "yes"
  else
    echo "no"
  fi
}

INSTALL_ROOT="$(get_key "install_root" "${HOME}/Applications/Mesora")"
INSTALL_POSTGRES="$(to_bool "$(get_key "install_postgres" "yes")")"
POSTGRES_SUPER_USER="$(get_key "postgres_super_user" "postgres")"
POSTGRES_SUPER_PASSWORD="$(get_key "postgres_super_password" "postgres")"
INSTALL_OLLAMA="$(to_bool "$(get_key "install_ollama" "yes")")"

cmd=(bash "${INSTALL_SCRIPT}" --install-root "${INSTALL_ROOT}")

if [[ "${INSTALL_POSTGRES}" == "no" ]]; then
  cmd+=(--skip-postgres-install)
else
  [[ -n "${POSTGRES_SUPER_USER}" ]] && cmd+=(--postgres-super-user "${POSTGRES_SUPER_USER}")
  [[ -n "${POSTGRES_SUPER_PASSWORD}" ]] && cmd+=(--postgres-super-password "${POSTGRES_SUPER_PASSWORD}")
fi

if [[ "${INSTALL_OLLAMA}" == "no" ]]; then
  cmd+=(--skip-ollama-install)
fi

set +e
output="$("${cmd[@]}" 2>&1)"
status=$?
set -e

if [[ ${status} -eq 0 ]]; then
  osascript -e 'display notification "Mesora installation completed successfully." with title "Mesora Installer"'
  exit 0
fi

osascript -e 'display dialog "Installation failed:\n'"${output//$'\n'/$'\\n'}"'" buttons {"OK"} default button "OK"'
exit ${status}
