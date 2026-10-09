export type Mode = "copy" | "sync";
export type Intent = "put" | "delete";
export type Phase = "settling" | "uploading" | "synced" | "failed" | "kept" | "removing";

export type Settings = {
  localFolder: string;
  remoteName: string;
  remoteFolder: string;
  debounceSeconds: number;
  mode: Mode;
  ignoreText: string;
  retries: number;
};

export type LaneFile = {
  id: string;
  name: string;
  bytes: number;
  phase: Phase;
  intent: Intent;
  attempt: number;
};

export type LogLine = { id: string; text: string };

export type EngineState = {
  files: LaneFile[];
  paused: boolean;
  failNext: boolean;
  settleAt: number | null;
  heldMs: number | null;
  uploadUntil: number | null;
  uploadHeldMs: number | null;
  logs: LogLine[];
  seq: number;
};

export const DEFAULT_IGNORE = [".*", "*.tmp", "*.partial", "*~", ".#*"];

export const DEFAULT_SETTINGS: Settings = {
  localFolder: "~/ProtonInbox",
  remoteName: "proton",
  remoteFolder: "Inbox",
  debounceSeconds: 3,
  mode: "copy",
  ignoreText: DEFAULT_IGNORE.join("\n"),
  retries: 5,
};

export function initialEngine(): EngineState {
  return {
    files: [],
    paused: false,
    failNext: false,
    settleAt: null,
    heldMs: null,
    uploadUntil: null,
    uploadHeldMs: null,
    logs: [],
    seq: 1,
  };
}

export function ignoreList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function globToReg(glob: string): RegExp {
  let out = "^";
  for (const ch of glob) {
    if (ch === "*") out += ".*";
    else if (ch === "?") out += ".";
    else if ("\\^$+()[]{}|.".includes(ch)) out += `\\${ch}`;
    else out += ch;
  }
  return new RegExp(`${out}$`);
}

export function isIgnored(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => globToReg(pattern).test(name));
}

export function settingsError(settings: Settings): string | null {
  if (!settings.localFolder.startsWith("/") && !settings.localFolder.startsWith("~/")) {
    return "Local folder should be absolute or start with ~/.";
  }
  if (/[\n\r\0]/.test(settings.localFolder)) return "Local folder cannot contain a newline.";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(settings.remoteName)) {
    return "Remote name should match your rclone remote, usually proton.";
  }
  if (!settings.remoteFolder.trim() || /[\n\r\0]/.test(settings.remoteFolder)) {
    return "Remote folder is required.";
  }
  if (settings.debounceSeconds < 1 || settings.debounceSeconds > 120) {
    return "Settle time should be between 1 and 120 seconds.";
  }
  if (settings.retries < 1 || settings.retries > 20) return "Retries should be between 1 and 20.";
  return null;
}

export function remoteTarget(settings: Settings): string {
  const folder = settings.remoteFolder.replace(/^\/+/, "");
  return `${settings.remoteName}:${folder}`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:~-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function rclonePreview(settings: Settings): string {
  const excludes = ignoreList(settings.ignoreText)
    .map((pattern) => `--exclude ${shellQuote(pattern)}`)
    .join(" ");
  const command = [
    "rclone",
    settings.mode,
    shellQuote(settings.localFolder),
    shellQuote(remoteTarget(settings)),
    excludes,
  ]
    .filter(Boolean)
    .join(" ");
  return command;
}

function withLog(state: EngineState, text: string): EngineState {
  return {
    ...state,
    seq: state.seq + 1,
    logs: [{ id: `log-${state.seq}`, text }, ...state.logs].slice(0, 14),
  };
}

function armSettle(state: EngineState, debounceMs: number, now: number): EngineState {
  if (state.paused) return { ...state, heldMs: debounceMs, settleAt: null };
  return { ...state, settleAt: now + debounceMs, heldMs: null };
}

function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let n = 2;
  let next = `${stem}-${n}${ext}`;
  while (taken.has(next)) {
    n += 1;
    next = `${stem}-${n}${ext}`;
  }
  return next;
}

export function addNames(
  state: EngineState,
  incoming: { name: string; bytes: number }[],
  patterns: string[],
  debounceMs: number,
  now: number,
): EngineState {
  let next = state;
  const accepted: LaneFile[] = [];
  const taken = new Set(next.files.filter((file) => file.phase !== "kept").map((file) => file.name));
  for (const item of incoming) {
    const base = item.name.split(/[/\\]/).pop()?.trim() ?? "";
    if (!base || base === "." || base === "..") continue;
    if (isIgnored(base, patterns)) {
      next = withLog(next, `Ignored ${base}`);
      continue;
    }
    const name = uniqueName(base, taken);
    taken.add(name);
    accepted.push({
      id: `f-${next.seq}`,
      name,
      bytes: Math.max(0, item.bytes),
      phase: "settling",
      intent: "put",
      attempt: 0,
    });
    next = { ...next, seq: next.seq + 1 };
  }
  if (accepted.length === 0) return next;
  next = {
    ...next,
    files: [...next.files, ...accepted],
  };
  next = armSettle(next, debounceMs, now);
  const label = accepted.length === 1 ? accepted[0].name : `${accepted.length} files`;
  return withLog(next, `Noticed ${label}. Waiting for the folder to sit still.`);
}

export function removeFile(
  state: EngineState,
  id: string,
  mode: Mode,
  debounceMs: number,
  now: number,
): EngineState {
  const file = state.files.find((item) => item.id === id);
  if (!file || file.phase === "uploading") return state;
  if (file.phase === "settling" || file.phase === "failed" || file.phase === "removing") {
    const files = state.files.filter((item) => item.id !== id);
    const stillPending = files.some((item) => item.phase === "settling" || item.phase === "removing");
    return {
      ...state,
      files,
      settleAt: stillPending ? state.settleAt : null,
      heldMs: stillPending ? state.heldMs : null,
    };
  }
  if (file.phase === "kept") {
    return { ...state, files: state.files.filter((item) => item.id !== id) };
  }
  if (mode === "copy") {
    return withLog(
      {
        ...state,
        files: state.files.map((item) => (item.id === id ? { ...item, phase: "kept" } : item)),
      },
      `${file.name} left the folder. Copy mode leaves it on Drive.`,
    );
  }
  const next = armSettle(
    {
      ...state,
      files: state.files.map((item) =>
        item.id === id ? { ...item, phase: "removing", intent: "delete" } : item,
      ),
    },
    debounceMs,
    now,
  );
  return withLog(next, `${file.name} will be removed on Drive after the folder settles.`);
}

export function retryFailed(state: EngineState, debounceMs: number, now: number): EngineState {
  if (!state.files.some((file) => file.phase === "failed")) return state;
  const next = armSettle(
    {
      ...state,
      files: state.files.map((file) =>
        file.phase === "failed"
          ? { ...file, phase: file.intent === "delete" ? "removing" : "settling" }
          : file,
      ),
    },
    debounceMs,
    now,
  );
  return withLog(next, "Retrying the failed batch.");
}

export function setPaused(state: EngineState, paused: boolean, now: number): EngineState {
  if (paused === state.paused) return state;
  if (paused) {
    return withLog(
      {
        ...state,
        paused: true,
        heldMs: state.settleAt == null ? state.heldMs : Math.max(0, state.settleAt - now),
        settleAt: null,
        uploadHeldMs: state.uploadUntil == null ? null : Math.max(0, state.uploadUntil - now),
        uploadUntil: null,
      },
      "Paused. Nothing uploads until you resume.",
    );
  }
  return withLog(
    {
      ...state,
      paused: false,
      settleAt: state.heldMs == null ? null : now + state.heldMs,
      heldMs: null,
      uploadUntil: state.uploadHeldMs == null ? null : now + state.uploadHeldMs,
      uploadHeldMs: null,
    },
    "Watching again.",
  );
}

export function armFailure(state: EngineState): EngineState {
  if (state.failNext) return state;
  return withLog({ ...state, failNext: true }, "The next upload will fail once, then retry.");
}

export function resetEngine(): EngineState {
  return withLog(initialEngine(), "Folder cleared.");
}

function uploadMs(count: number): number {
  return Math.min(2200, 650 + count * 90);
}

export function step(state: EngineState, now: number, debounceMs: number): EngineState {
  if (state.paused) return state;
  if (state.uploadUntil != null) {
    if (now < state.uploadUntil) return state;
    const batch = state.files.filter((file) => file.phase === "uploading");
    if (state.failNext) {
      const ids = new Set(batch.map((file) => file.id));
      return withLog(
        {
          ...state,
          failNext: false,
          uploadUntil: null,
          files: state.files.map((file) =>
            ids.has(file.id) ? { ...file, phase: "failed", attempt: file.attempt + 1 } : file,
          ),
        },
        "Upload failed. The files stay put until you retry.",
      );
    }
    const ids = new Set(batch.map((file) => file.id));
    const removed = batch.filter((file) => file.intent === "delete").length;
    const uploaded = batch.length - removed;
    const files = state.files.flatMap((file) => {
      if (!ids.has(file.id)) return [file];
      if (file.intent === "delete") return [];
      return [{ ...file, phase: "synced" as const, attempt: 0 }];
    });
    let next: EngineState = { ...state, files, uploadUntil: null };
    const parts = [
      uploaded > 0 ? `Uploaded ${uploaded} ${uploaded === 1 ? "file" : "files"}` : "",
      removed > 0 ? `removed ${removed} on Drive` : "",
    ].filter(Boolean);
    next = withLog(next, `${parts.join(", ")}.`);
    if (next.files.some((file) => file.phase === "settling" || file.phase === "removing")) {
      return armSettle(next, debounceMs, now);
    }
    return next;
  }
  if (state.settleAt == null || now < state.settleAt) return state;
  const batch = state.files.filter((file) => file.phase === "settling" || file.phase === "removing");
  if (batch.length === 0) return { ...state, settleAt: null };
  const ids = new Set(batch.map((file) => file.id));
  return withLog(
    {
      ...state,
      settleAt: null,
      uploadUntil: now + uploadMs(batch.length),
      files: state.files.map((file) => (ids.has(file.id) ? { ...file, phase: "uploading" } : file)),
    },
    `Uploading ${batch.length} ${batch.length === 1 ? "change" : "changes"}.`,
  );
}

export function settleRemaining(state: EngineState, now: number): number | null {
  if (!state.files.some((file) => file.phase === "settling" || file.phase === "removing")) return null;
  if (state.paused) return state.heldMs;
  if (state.settleAt == null) return null;
  return Math.max(0, state.settleAt - now);
}

export function uploadProgress(state: EngineState, now: number): number | null {
  const uploading = state.files.some((file) => file.phase === "uploading");
  if (!uploading) return null;
  const end = state.paused ? null : state.uploadUntil;
  const held = state.paused ? state.uploadHeldMs : null;
  if (end == null && held == null) return 0.5;
  const total = uploadMs(state.files.filter((file) => file.phase === "uploading").length);
  const left = end != null ? Math.max(0, end - now) : (held ?? total);
  return Math.min(1, Math.max(0.08, 1 - left / total));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`;
}
