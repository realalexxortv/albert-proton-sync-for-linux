#!/bin/sh
# Install Lane for the current user. No root, no browser.
# Puts the program in ~/.local/bin, downloads rclone there if needed,
# then runs `lane setup` (Proton sign-in, folder, background service).
set -eu

SRC=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR" "$HOME/.config/lane" "$HOME/.config/systemd/user"
install -m 755 "$SRC/lane" "$BIN_DIR/lane"

PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
for rc in "$HOME/.profile" "$HOME/.bashrc"; do
  if [ -f "$rc" ] && grep -q '.local/bin' "$rc"; then
    continue
  fi
  # Only touch files that already exist, plus .profile so login shells find Lane.
  if [ "$rc" = "$HOME/.profile" ] || [ -f "$rc" ]; then
    printf '\n# Lane and a user-local rclone\n%s\n' "$PATH_LINE" >> "$rc"
  fi
done
export PATH="$BIN_DIR:$PATH"

ensure_rclone() {
  if command -v rclone >/dev/null 2>&1; then
    return 0
  fi
  arch=$(uname -m)
  case "$arch" in
    x86_64) plat=amd64 ;;
    aarch64|arm64) plat=arm64 ;;
    *)
      echo "rclone is not installed, and this installer does not know a build for $arch." >&2
      echo "Install rclone, then run this script again." >&2
      return 1
      ;;
  esac
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT INT TERM
  url="https://downloads.rclone.org/current/rclone-current-linux-${plat}.zip"
  echo "Downloading rclone for linux-$plat…"
  curl -fsSL "$url" -o "$tmp/rclone.zip"
  unzip -q "$tmp/rclone.zip" -d "$tmp"
  found=$(find "$tmp" -type f -name rclone | head -n 1)
  if [ -z "$found" ]; then
    echo "The rclone archive did not contain a binary." >&2
    return 1
  fi
  install -m 755 "$found" "$BIN_DIR/rclone"
  rm -rf "$tmp"
  trap - EXIT INT TERM
  echo "Installed rclone to $BIN_DIR/rclone"
}

ensure_rclone

echo
echo "Lane is in $BIN_DIR/lane"
if [ "${LANE_NONINTERACTIVE:-}" = "1" ]; then
  exec "$BIN_DIR/lane" setup \
    --folder "${LANE_FOLDER:-$HOME/ProtonInbox}" \
    --remote "${LANE_REMOTE:-proton}" \
    --drive-folder "${LANE_DRIVE_FOLDER:-Inbox}" \
    --mode "${LANE_MODE:-copy}" \
    --debounce "${LANE_DEBOUNCE:-3}" \
    --skip-remote \
    --no-start
fi

exec "$BIN_DIR/lane" setup
