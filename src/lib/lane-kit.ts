import { ignoreList, remoteTarget, type Settings } from "@/lib/lane-engine";

const PYTHON = String.raw`#!/usr/bin/env python3
"""Lane — one-way folder upload into Proton Drive.

Watches a local directory. After it stays quiet for debounce_seconds, runs
rclone copy (never deletes remote files) or rclone sync (mirrors deletions).
Proton's encryption stays inside rclone's protondrive backend.
"""

from __future__ import annotations

import ctypes
import ctypes.util
import fnmatch
import json
import os
import select
import shutil
import signal
import struct
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

IN_MODIFY = 0x00000002
IN_CLOSE_WRITE = 0x00000008
IN_MOVED_FROM = 0x00000040
IN_MOVED_TO = 0x00000080
IN_CREATE = 0x00000100
IN_DELETE = 0x00000200
IN_Q_OVERFLOW = 0x00004000
IN_NONBLOCK = 0x00000800
IN_ONLYDIR = 0x01000000
MASK = IN_MODIFY | IN_CLOSE_WRITE | IN_MOVED_FROM | IN_MOVED_TO | IN_CREATE | IN_DELETE

STOP = False


def log(msg: str) -> None:
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    print(f"{stamp} {msg}", flush=True)


def handle_stop(signum, frame):  # noqa: ARG001
    global STOP
    STOP = True


def config_path() -> Path:
    override = os.environ.get("LANE_CONFIG")
    if override:
        return Path(override)
    return Path.home() / ".config" / "lane" / "config.json"


def load() -> dict:
    path = config_path()
    with path.open(encoding="utf-8") as handle:
        cfg = json.load(handle)
    mode = cfg.get("mode", "copy")
    if mode not in ("copy", "sync"):
        raise SystemExit(f"mode must be copy or sync, not {mode!r}")
    local = Path(cfg["local"]).expanduser()
    ignore = cfg.get("ignore") or []
    if not isinstance(ignore, list):
        raise SystemExit("ignore must be a list of globs")
    debounce = float(cfg.get("debounce_seconds", 3))
    retries = int(cfg.get("retries", 5))
    if debounce < 0.2:
        raise SystemExit("debounce_seconds is too small")
    if retries < 1:
        raise SystemExit("retries must be at least 1")
    return {
        "local": local,
        "remote": str(cfg["remote"]),
        "mode": mode,
        "ignore": [str(item) for item in ignore],
        "debounce_seconds": debounce,
        "retries": retries,
        "rclone": str(cfg.get("rclone") or "rclone"),
    }


def ignored(rel: str, patterns: list[str]) -> bool:
    name = rel.rsplit("/", 1)[-1]
    return any(fnmatch.fnmatch(name, pattern) or fnmatch.fnmatch(rel, pattern) for pattern in patterns)


def snapshot(root: Path, patterns: list[str]) -> dict[str, tuple[int, int]]:
    found: dict[str, tuple[int, int]] = {}
    if not root.exists():
        return found
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if not ignored(name, patterns)]
        for name in filenames:
            path = Path(dirpath) / name
            rel = path.relative_to(root).as_posix()
            if ignored(rel, patterns):
                continue
            try:
                st = path.stat()
            except FileNotFoundError:
                continue
            found[rel] = (st.st_mtime_ns, st.st_size)
    return found


class Inotify:
    def __init__(self, root: Path):
        libname = ctypes.util.find_library("c") or "libc.so.6"
        self.libc = ctypes.CDLL(libname, use_errno=True)
        self.libc.inotify_init1.argtypes = [ctypes.c_int]
        self.libc.inotify_init1.restype = ctypes.c_int
        self.libc.inotify_add_watch.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32]
        self.libc.inotify_add_watch.restype = ctypes.c_int
        self.fd = self.libc.inotify_init1(IN_NONBLOCK)
        if self.fd < 0:
            err = ctypes.get_errno()
            raise OSError(err, os.strerror(err))
        self.wds: dict[int, Path] = {}
        self.patterns: list[str] = []
        self.add_tree(root)

    def add_dir(self, path: Path) -> None:
        wd = self.libc.inotify_add_watch(self.fd, os.fsencode(path), MASK | IN_ONLYDIR)
        if wd >= 0:
            self.wds[wd] = path

    def add_tree(self, root: Path) -> None:
        for dirpath, dirnames, _filenames in os.walk(root):
            self.add_dir(Path(dirpath))
            dirnames[:] = list(dirnames)

    def poll(self, timeout: float, patterns: list[str]) -> bool:
        ready, _, _ = select.select([self.fd], [], [], timeout)
        if not ready:
            return False
        changed = False
        try:
            data = os.read(self.fd, 65536)
        except BlockingIOError:
            return False
        off = 0
        while off + 16 <= len(data):
            wd, mask, _cookie, name_len = struct.unpack_from("iIII", data, off)
            off += 16
            raw = data[off : off + name_len].split(b"\x00", 1)[0]
            off += name_len
            name = os.fsdecode(raw) if raw else ""
            parent = self.wds.get(wd, Path("."))
            full = parent / name if name else parent
            if mask & IN_Q_OVERFLOW:
                changed = True
                continue
            if name and ignored(name, patterns):
                continue
            if mask & IN_CREATE and full.is_dir():
                self.add_tree(full)
            changed = True
        return changed

    def close(self) -> None:
        os.close(self.fd)


def rclone_cmd(cfg: dict) -> list[str]:
    cmd = [
        cfg["rclone"],
        cfg["mode"],
        str(cfg["local"]),
        cfg["remote"],
        "--retries",
        "1",
        "--low-level-retries",
        "2",
        "--stats",
        "0",
    ]
    for pattern in cfg["ignore"]:
        cmd.extend(["--exclude", pattern])
    return cmd


def upload(cfg: dict) -> bool:
    delay = 2.0
    for attempt in range(1, cfg["retries"] + 1):
        if STOP:
            return False
        log(f"upload attempt {attempt} {cfg['mode']} {cfg['local']} -> {cfg['remote']}")
        proc = subprocess.run(rclone_cmd(cfg), check=False)
        if proc.returncode == 0:
            log("upload ok")
            return True
        log(f"upload failed status {proc.returncode}")
        if attempt < cfg["retries"]:
            time.sleep(delay)
            delay = min(delay * 2, 60)
    return False


def main() -> int:
    signal.signal(signal.SIGTERM, handle_stop)
    signal.signal(signal.SIGINT, handle_stop)
    try:
        cfg = load()
    except (OSError, json.JSONDecodeError, KeyError) as exc:
        log(f"config error: {exc}")
        return 1
    local: Path = cfg["local"]
    if not local.is_dir():
        if cfg["mode"] == "sync":
            log(f"refusing sync, folder does not exist: {local}")
            return 1
        local.mkdir(parents=True, exist_ok=True)
        log(f"created {local}")
    rclone = cfg["rclone"]
    if shutil.which(rclone) is None and not Path(rclone).is_file():
        log(f"rclone not found ({rclone}). Install rclone and run: rclone config")
        return 1
    watcher = None
    try:
        watcher = Inotify(local)
        log(f"watching {local} with inotify, mode {cfg['mode']}, quiet {cfg['debounce_seconds']}s")
    except OSError as exc:
        log(f"inotify unavailable ({exc}); polling every 2s")
    dirty = True
    quiet_at = time.monotonic()
    last_snap: Optional[dict[str, tuple[int, int]]] = None
    while not STOP:
        if watcher is not None:
            try:
                if watcher.poll(0.4, cfg["ignore"]):
                    dirty = True
                    quiet_at = time.monotonic()
            except OSError as exc:
                log(f"inotify error ({exc}); switching to polling")
                watcher.close()
                watcher = None
        else:
            snap = snapshot(local, cfg["ignore"])
            if last_snap is not None and snap != last_snap:
                dirty = True
                quiet_at = time.monotonic()
            last_snap = snap
            time.sleep(2)
        if dirty and time.monotonic() - quiet_at >= cfg["debounce_seconds"]:
            if upload(cfg):
                dirty = False
            else:
                quiet_at = time.monotonic()
    if watcher is not None:
        watcher.close()
    log("stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
`;

const UNIT = `[Unit]
Description=Lane one-way Proton Drive folder sync
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=%h/.local/bin/lane
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`;

export function laneConfig(settings: Settings): string {
  return JSON.stringify(
    {
      local: settings.localFolder,
      remote: remoteTarget(settings),
      mode: settings.mode,
      debounce_seconds: settings.debounceSeconds,
      retries: settings.retries,
      ignore: ignoreList(settings.ignoreText),
      rclone: "rclone",
    },
    null,
    2,
  );
}

export function serviceUnit(): string {
  return UNIT;
}

export function installScript(settings: Settings): string {
  const config = laneConfig(settings);
  return `#!/bin/sh
# Lane — install the one-way Proton Drive folder watcher for this user.
# Requires: rclone, already configured with a protondrive remote.
#   rclone config
# Desktop sessions start the service at login.
# A machine that should keep syncing with nobody logged in:
#   loginctl enable-linger "$USER"
set -eu
mkdir -p "$HOME/.local/bin" "$HOME/.config/lane" "$HOME/.config/systemd/user"
cat > "$HOME/.local/bin/lane" << 'END_LANE'
${PYTHON}
END_LANE
chmod 755 "$HOME/.local/bin/lane"
cat > "$HOME/.config/lane/config.json" << 'END_CFG'
${config}
END_CFG
cat > "$HOME/.config/systemd/user/lane.service" << 'END_UNIT'
${UNIT}
END_UNIT
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload
  systemctl --user enable --now lane.service
  echo "Lane is running. Logs: journalctl --user -u lane.service -f"
else
  echo "Files installed. systemctl is not available; start with: $HOME/.local/bin/lane"
fi
`;
}
