#!/usr/bin/env bash
# Install goose-serve as a systemd user service
# Usage: bash install.sh [--uninstall]

set -euo pipefail

SERVICE_NAME="goose-serve"
SERVICE_FILE="$(dirname "$0")/goose-serve.service"
SYSTEMD_USER_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

if [[ "${1:-}" == "--uninstall" ]]; then
    systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true
    systemctl --user disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "$SYSTEMD_USER_DIR/$SERVICE_NAME.service"
    systemctl --user daemon-reload
    echo "Uninstalled $SERVICE_NAME"
    exit 0
fi

if ! command -v goose &>/dev/null; then
    echo "Error: goose binary not found in PATH" >&2
    echo "Install goose first: https://github.com/aaif-goose/goose#installation" >&2
    exit 1
fi

mkdir -p "$SYSTEMD_USER_DIR"
cp "$SERVICE_FILE" "$SYSTEMD_USER_DIR/"
systemctl --user daemon-reload
systemctl --user enable --now "$SERVICE_NAME"

# Enable lingering so service starts without login session (for headless servers)
if command -v loginctl &>/dev/null; then
    loginctl enable-linger "$USER" 2>/dev/null || true
fi

echo "Installed and started $SERVICE_NAME"
echo "Status: systemctl --user status $SERVICE_NAME"
echo "Logs:   journalctl --user -u $SERVICE_NAME -f"
