import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileText,
  FolderInput,
  Pause,
  Play,
  RotateCcw,
  Shield,
  X,
} from "lucide-react";
import {
  DEFAULT_SETTINGS,
  addNames,
  armFailure,
  formatBytes,
  ignoreList,
  initialEngine,
  rclonePreview,
  removeFile,
  resetEngine,
  retryFailed,
  setPaused,
  settingsError,
  settleRemaining,
  step,
  uploadProgress,
  type EngineState,
  type Settings,
} from "@/lib/lane-engine";
import { installScript, laneConfig, serviceUnit } from "@/lib/lane-kit";

const STORAGE_KEY = "lane-settings-v1";
const SAMPLES = [
  { name: "boarding-pass.pdf", bytes: 184320 },
  { name: "taxes-2025.pdf", bytes: 2401280 },
  { name: "voice-memo.m4a", bytes: 6400000 },
];

type KitTab = "install" | "unit" | "config";

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function LaneDesk() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [engine, setEngine] = useState<EngineState>(initialEngine);
  const [now, setNow] = useState(() => Date.now());
  const [hot, setHot] = useState(false);
  const [tab, setTab] = useState<KitTab>("install");
  const [copied, setCopied] = useState<KitTab | "command" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef(settings.debounceSeconds * 1000);
  debounceRef.current = settings.debounceSeconds * 1000;

  useEffect(() => {
    setSettings(loadSettings());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings, ready]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      setEngine((prev) => step(prev, tick, debounceRef.current));
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  const error = settingsError(settings);
  const patterns = useMemo(() => ignoreList(settings.ignoreText), [settings.ignoreText]);
  const remaining = settleRemaining(engine, now);
  const progress = uploadProgress(engine, now);
  const inFolder = engine.files.filter((file) => file.phase !== "kept");
  const kept = engine.files.filter((file) => file.phase === "kept");
  const uploading = engine.files.some((file) => file.phase === "uploading");
  const failed = engine.files.some((file) => file.phase === "failed");
  const command = rclonePreview(settings);
  const kit = useMemo(() => {
    if (error) return { install: "", unit: serviceUnit(), config: "" };
    return {
      install: installScript(settings),
      unit: serviceUnit(),
      config: laneConfig(settings),
    };
  }, [settings, error]);

  function patch(partial: Partial<Settings>) {
    setSettings((prev) => ({ ...prev, ...partial }));
  }

  function add(items: { name: string; bytes: number }[]) {
    const tick = Date.now();
    setNow(tick);
    setEngine((prev) => addNames(prev, items, patterns, settings.debounceSeconds * 1000, tick));
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setHot(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    add(files.map((file) => ({ name: file.name, bytes: file.size })));
  }

  async function copyText(id: KitTab | "command", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 1500);
    } catch {
      setCopied(null);
    }
  }

  function downloadKit() {
    if (error || !kit.install) return;
    const blob = new Blob([kit.install], { type: "text/x-shellscript" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lane-install.sh";
    link.click();
    URL.revokeObjectURL(url);
  }

  const kitBody = tab === "install" ? kit.install : tab === "unit" ? kit.unit : kit.config;
  const status = engine.paused ? "Paused" : uploading ? "Uploading" : remaining != null ? "Settling" : "Watching";

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold tracking-widest text-muted uppercase">Proton Drive · Linux</p>
          <h1 className="font-display text-4xl leading-none font-semibold text-ink sm:text-5xl">Lane</h1>
          <p className="max-w-xl text-base text-muted">
            Drop files in one folder. After they sit still, they upload to Proton Drive. Copy mode never
            deletes anything already up there.
          </p>
        </div>
        <p
          className={
            "inline-flex h-11 items-center gap-2 self-start rounded-full px-4 text-sm font-semibold " +
            (engine.paused ? "bg-line text-ink" : "bg-signal-soft text-signal")
          }
        >
          <span className={"size-2 rounded-full " + (engine.paused ? "bg-muted" : "bg-signal")} />
          {status}
        </p>
      </header>

      <p className="text-sm text-muted">
        This desk runs the same settle, ignore, and retry rules as the Linux watcher. It does not talk to
        Proton. The kit at the bottom is the program that calls rclone on your machine.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-4 rounded-card border border-line bg-card p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl font-semibold">Watched folder</h2>
              <p className="font-medium break-all text-muted">{settings.localFolder}</p>
            </div>
            <FolderInput className="size-5 shrink-0 text-signal" aria-hidden="true" />
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => fileRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileRef.current?.click();
              }
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setHot(true);
            }}
            onDragLeave={() => setHot(false)}
            onDrop={onDrop}
            className={
              "flex min-h-28 flex-col items-center justify-center gap-1 rounded-card border border-dashed px-4 py-6 text-center " +
              (hot ? "border-signal bg-signal-soft" : "border-line bg-paper")
            }
          >
            <p className="font-semibold">Drop files here</p>
            <p className="text-sm text-muted">or choose them. Nothing leaves this page.</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="sr-only"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length > 0) add(files.map((file) => ({ name: file.name, bytes: file.size })));
              event.target.value = "";
            }}
          />

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-ink px-4 text-sm font-semibold text-paper"
              onClick={() => add(SAMPLES)}
            >
              <FileText className="size-4" aria-hidden="true" />
              Add three samples
            </button>
            <button
              type="button"
              className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-card px-4 text-sm font-semibold"
              onClick={() => {
                const tick = Date.now();
                setNow(tick);
                setEngine((prev) => setPaused(prev, !prev.paused, tick));
              }}
            >
              {engine.paused ? <Play className="size-4" /> : <Pause className="size-4" />}
              {engine.paused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-card px-4 text-sm font-semibold"
              onClick={() => setEngine(resetEngine())}
            >
              Reset
            </button>
          </div>

          {remaining != null && (
            <p className="text-sm font-medium text-signal tabular-nums">
              Uploads in {(remaining / 1000).toFixed(1)}s — more files reset the wait
            </p>
          )}
          {progress != null && (
            <div className="h-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
              <div
                className="h-full origin-left bg-signal"
                style={{ transform: `scaleX(${progress})` }}
              />
            </div>
          )}

          {inFolder.length === 0 && kept.length === 0 ? (
            <p className="rounded-card bg-paper px-4 py-6 text-sm text-muted">
              The folder is empty. Drop something in, then watch it wait out the settle time before it
              counts as uploaded.
            </p>
          ) : (
            <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
              {inFolder.map((file) => (
                <li
                  key={file.id}
                  className="flex items-center gap-3 rounded-card border border-line px-3 py-2"
                >
                  <PhaseMark phase={file.phase} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{file.name}</p>
                    <p className="text-sm text-muted">
                      {formatBytes(file.bytes)} · {phaseLabel(file.phase, file.attempt)}
                    </p>
                  </div>
                  {file.phase !== "uploading" && (
                    <button
                      type="button"
                      className="inline-flex size-11 items-center justify-center rounded-full text-muted"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => {
                        const tick = Date.now();
                        setNow(tick);
                        setEngine((prev) =>
                          removeFile(prev, file.id, settings.mode, settings.debounceSeconds * 1000, tick),
                        );
                      }}
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {kept.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-muted">Still on Drive, not in the folder</h3>
              <ul className="flex flex-col gap-2">
                {kept.map((file) => (
                  <li key={file.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">{file.name}</span>
                    <span className="shrink-0 text-muted">left in place</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!failed}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold disabled:opacity-40"
              onClick={() => {
                const tick = Date.now();
                setNow(tick);
                setEngine((prev) => retryFailed(prev, settings.debounceSeconds * 1000, tick));
              }}
            >
              <RotateCcw className="size-4" />
              Retry failed
            </button>
            <button
              type="button"
              className="inline-flex h-11 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold"
              onClick={() => setEngine((prev) => armFailure(prev))}
            >
              Fail the next upload
            </button>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <form
            className="flex flex-col gap-4 rounded-card border border-line bg-card p-4 sm:p-5"
            onSubmit={(event) => event.preventDefault()}
          >
            <h2 className="font-display text-2xl font-semibold">Lane settings</h2>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Local folder
              <input
                value={settings.localFolder}
                onChange={(event) => patch({ localFolder: event.target.value })}
                className="h-11 rounded-card border border-line bg-paper px-3 font-normal"
                spellCheck={false}
              />
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-semibold">
                rclone remote
                <input
                  value={settings.remoteName}
                  onChange={(event) => patch({ remoteName: event.target.value })}
                  className="h-11 rounded-card border border-line bg-paper px-3 font-normal"
                  spellCheck={false}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Drive folder
                <input
                  value={settings.remoteFolder}
                  onChange={(event) => patch({ remoteFolder: event.target.value })}
                  className="h-11 rounded-card border border-line bg-paper px-3 font-normal"
                  spellCheck={false}
                />
              </label>
            </div>
            <label className="flex flex-col gap-2 text-sm font-semibold">
              <span className="flex items-center justify-between">
                Settle time
                <span className="font-normal text-muted tabular-nums">{settings.debounceSeconds}s</span>
              </span>
              <input
                type="range"
                min={1}
                max={30}
                value={settings.debounceSeconds}
                onChange={(event) => patch({ debounceSeconds: Number(event.target.value) })}
              />
            </label>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-semibold">Upload rule</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <ModeButton
                  pressed={settings.mode === "copy"}
                  title="Copy"
                  detail="New and changed files go up. Deleting locally does nothing on Drive."
                  onClick={() => patch({ mode: "copy" })}
                />
                <ModeButton
                  pressed={settings.mode === "sync"}
                  title="Sync"
                  detail="The Drive folder becomes a mirror. Missing local files are deleted there."
                  onClick={() => patch({ mode: "sync" })}
                />
              </div>
            </fieldset>
            {settings.mode === "sync" && (
              <p className="flex gap-2 rounded-card bg-fail-soft px-3 py-3 text-sm text-fail">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                Sync deletes files on Proton Drive that are not in this folder, including an empty one.
              </p>
            )}
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Ignore globs
              <textarea
                value={settings.ignoreText}
                onChange={(event) => patch({ ignoreText: event.target.value })}
                rows={4}
                className="rounded-card border border-line bg-paper px-3 py-2 font-normal"
                spellCheck={false}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              Retries after a failed upload
              <input
                type="number"
                min={1}
                max={20}
                value={settings.retries}
                onChange={(event) => patch({ retries: Number(event.target.value) })}
                className="h-11 w-24 rounded-card border border-line bg-paper px-3 font-normal"
              />
            </label>
            {error && <p className="text-sm text-fail">{error}</p>}
          </form>

          <div className="flex flex-col gap-3 rounded-card border border-line bg-card p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-2xl font-semibold">Next rclone call</h2>
              <button
                type="button"
                className="inline-flex h-11 items-center gap-2 rounded-full border border-line px-3 text-sm font-semibold"
                onClick={() => copyText("command", command)}
              >
                {copied === "command" ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied === "command" ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="overflow-x-auto rounded-card bg-paper p-3 text-sm break-all whitespace-pre-wrap text-ink">
              {command}
            </pre>
          </div>
        </section>
      </div>

      <section className="grid grid-cols-1 gap-4 rounded-card border border-line bg-card p-4 sm:p-5 lg:grid-cols-5">
        <div className="flex flex-col gap-3 lg:col-span-2">
          <h2 className="font-display text-2xl font-semibold">Activity</h2>
          {engine.logs.length === 0 ? (
            <p className="text-sm text-muted">Quiet. The watcher logs each notice, upload, and failure.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {engine.logs.map((line) => (
                <li key={line.id} className="text-sm">
                  {line.text}
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="flex flex-col gap-3 lg:col-span-3">
          <div className="flex items-start gap-3">
            <Shield className="mt-1 size-5 shrink-0 text-signal" aria-hidden="true" />
            <div>
              <h2 className="font-display text-2xl font-semibold">Linux kit</h2>
              <p className="text-sm text-muted">
                One install script writes the watcher, your config, and a user service. rclone must already
                have a protondrive remote with this name. Lane never sees your Proton password.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <KitTabButton current={tab} id="install" label="Install script" onSelect={setTab} />
            <KitTabButton current={tab} id="unit" label="Service" onSelect={setTab} />
            <KitTabButton current={tab} id="config" label="Config" onSelect={setTab} />
          </div>
          <pre className="max-h-64 overflow-auto rounded-card bg-paper p-3 text-sm break-all whitespace-pre-wrap">
            {error ? "Fix the settings above to generate this file." : kitBody}
          </pre>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={Boolean(error)}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-signal px-4 text-sm font-semibold text-paper disabled:opacity-40"
              onClick={downloadKit}
            >
              <Download className="size-4" />
              Download lane-install.sh
            </button>
            <button
              type="button"
              disabled={Boolean(error) || !kitBody}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold disabled:opacity-40"
              onClick={() => copyText(tab, kitBody)}
            >
              {copied === tab ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied === tab ? "Copied" : "Copy this file"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function phaseLabel(phase: string, attempt: number): string {
  if (phase === "settling") return "settling";
  if (phase === "uploading") return "uploading";
  if (phase === "synced") return "on Drive";
  if (phase === "removing") return "pending delete";
  if (phase === "failed") return attempt > 1 ? `failed, attempt ${attempt}` : "failed";
  return phase;
}

function PhaseMark({ phase }: { phase: string }) {
  const tone =
    phase === "synced"
      ? "bg-signal-soft text-signal"
      : phase === "failed"
        ? "bg-fail-soft text-fail"
        : "bg-line text-ink";
  return (
    <span className={"inline-flex size-8 shrink-0 items-center justify-center rounded-full " + tone}>
      {phase === "synced" ? (
        <Check className="size-4" aria-hidden="true" />
      ) : phase === "failed" ? (
        <AlertTriangle className="size-4" aria-hidden="true" />
      ) : (
        <FileText className="size-4" aria-hidden="true" />
      )}
    </span>
  );
}

function ModeButton({
  pressed,
  title,
  detail,
  onClick,
}: {
  pressed: boolean;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={
        "flex flex-col gap-1 rounded-card border px-3 py-3 text-left " +
        (pressed ? "border-signal bg-signal-soft" : "border-line bg-paper")
      }
    >
      <span className="text-sm font-semibold">{title}</span>
      <span className="text-sm font-normal text-muted">{detail}</span>
    </button>
  );
}

function KitTabButton({
  current,
  id,
  label,
  onSelect,
}: {
  current: KitTab;
  id: KitTab;
  label: string;
  onSelect: (id: KitTab) => void;
}) {
  const selected = current === id;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(id)}
      className={
        "inline-flex h-11 items-center rounded-full px-4 text-sm font-semibold " +
        (selected ? "bg-ink text-paper" : "border border-line bg-card")
      }
    >
      {label}
    </button>
  );
}
