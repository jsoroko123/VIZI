#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
/usr/bin/osascript "$SCRIPT_DIR/Install-Vizi-GUI.applescript"
