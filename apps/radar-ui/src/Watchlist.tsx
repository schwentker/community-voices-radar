import { useEffect, useState } from "react";

import {
  api,
  getToken,
  setToken,
  slugify,
  type Entity,
  type Preset,
  type PreviewResult,
  type RadarConfig,
  type ScanRun,
  type Settings,
} from "./api";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500";
const primaryButton =
  "rounded-full bg-radar-purple px-4 py-2 text-sm font-semibold text-white transition hover:bg-radar-plum disabled:cursor-not-allowed disabled:opacity-60";
const ghostButton =
  "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-violet-200 hover:text-radar-purple disabled:opacity-60";

const toList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
const fromList = (value: string[]) => value.join(", ");

function blankEntity(): Entity {
  return {
    id: "",
    name: "",
    role: "competitor",
    aliases: [],
    exclude: [],
    sources: { reddit: { enabled: true, subreddits: [] }, discourse: { forums: [] } },
    painKeywords: [],
    color: "#6b4fbb",
    enabled: true,
  };
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

function ListInput({ value, onChange, placeholder }: { value: string[]; onChange: (next: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState(fromList(value));
  useEffect(() => setText(fromList(value)), [value]);
  return (
    <input
      className={inputClass}
      value={text}
      placeholder={placeholder}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => onChange(toList(text))}
    />
  );
}

function EntityEditor({
  initial,
  isNew,
  onSaved,
  onCancel,
}: {
  initial: Entity;
  isNew: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Entity>(initial);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState<"save" | "preview" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<Entity>) => setDraft((current) => ({ ...current, ...patch }));
  const updateReddit = (patch: Partial<Entity["sources"]["reddit"]>) =>
    setDraft((current) => ({ ...current, sources: { ...current.sources, reddit: { ...current.sources.reddit, ...patch } } }));
  const withId = (entity: Entity): Entity => ({ ...entity, id: entity.id || slugify(entity.name) });

  const runPreview = async () => {
    setBusy("preview");
    setError(null);
    try {
      setPreview(await api.preview(withId(draft)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      await api.saveEntity(withId(draft));
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 rounded-[24px] border border-violet-200 bg-violet-50/40 p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Field label="Company" hint={isNew && draft.name ? `id: ${slugify(draft.name)}` : `id: ${draft.id}`}>
          <input
            className={inputClass}
            value={draft.name}
            placeholder="e.g. BigCommerce"
            onChange={(event) => update({ name: event.target.value })}
          />
        </Field>
        <Field label="Color">
          <input
            type="color"
            className="h-10 w-14 cursor-pointer rounded-xl border border-slate-200 bg-white"
            value={draft.color}
            onChange={(event) => update({ color: event.target.value })}
          />
        </Field>
      </div>

      <div className="flex gap-2">
        {(["primary", "competitor"] as const).map((role) => (
          <button
            key={role}
            type="button"
            onClick={() => update({ role })}
            className={[
              "rounded-full border px-3 py-1.5 text-sm font-medium capitalize",
              draft.role === role ? "border-radar-purple bg-radar-purple text-white" : "border-slate-200 bg-white text-slate-700",
            ].join(" ")}
          >
            {role}
          </button>
        ))}
      </div>

      <Field label="Aliases" hint="Comma separated. Product names, nicknames, frameworks.">
        <ListInput value={draft.aliases} onChange={(aliases) => update({ aliases })} placeholder="shopify plus, hydrogen" />
      </Field>
      <Field label="Exclude" hint="Posts containing these are skipped (e.g. stock chatter).">
        <ListInput value={draft.exclude} onChange={(exclude) => update({ exclude })} placeholder="stock, earnings" />
      </Field>
      <Field label="Pain keywords" hint="Words that mark a post as a pain point.">
        <ListInput value={draft.painKeywords} onChange={(painKeywords) => update({ painKeywords })} placeholder="checkout, fees" />
      </Field>

      <div className="rounded-2xl border border-slate-200 bg-white/80 p-3">
        <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={draft.sources.reddit.enabled}
            onChange={(event) => updateReddit({ enabled: event.target.checked })}
          />
          Reddit
        </label>
        <div className="grid gap-3">
          <Field label="Subreddits" hint="Optional. Empty searches all of Reddit.">
            <ListInput
              value={draft.sources.reddit.subreddits}
              onChange={(subreddits) => updateReddit({ subreddits })}
              placeholder="shopify, ecommerce"
            />
          </Field>
          <Field label="Custom query" hint="Optional. Replaces the query built from name + aliases.">
            <input
              className={inputClass}
              value={draft.sources.reddit.query ?? ""}
              onChange={(event) => {
                const query = event.target.value;
                setDraft((current) => {
                  const { query: _old, ...reddit } = current.sources.reddit;
                  return { ...current, sources: { ...current.sources, reddit: query ? { ...reddit, query } : reddit } };
                });
              }}
            />
          </Field>
        </div>
      </div>

      <Field label="Discourse forums" hint="Optional. https URLs of public Discourse forums.">
        <ListInput
          value={draft.sources.discourse.forums}
          onChange={(forums) => setDraft((current) => ({ ...current, sources: { ...current.sources, discourse: { forums } } }))}
          placeholder="https://community.example.com"
        />
      </Field>

      {error ? <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      {preview ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">
          <div className={labelClass}>Dry run</div>
          <code className="block break-words rounded-lg bg-slate-900 px-3 py-2 text-xs text-violet-100">{preview.query}</code>
          {preview.status !== "ok" ? (
            <p className="mt-2 text-amber-700">Reddit returned {preview.status}. The query above is what a scan will use.</p>
          ) : preview.samples.length === 0 ? (
            <p className="mt-2 text-slate-600">No recent hits. Try more aliases or fewer excludes.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {preview.samples.map((sample) => (
                <li key={sample.id} className="text-slate-700">
                  <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                    r/{sample.meta?.subreddit ?? "?"}
                  </span>
                  {sample.meta?.url ? (
                    <a href={sample.meta.url} target="_blank" rel="noreferrer" className="hover:text-radar-purple hover:underline">
                      {sample.content.slice(0, 110)}
                    </a>
                  ) : (
                    sample.content.slice(0, 110)
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryButton} disabled={!draft.name || busy !== null} onClick={() => void save()}>
          {busy === "save" ? "Saving..." : "Save"}
        </button>
        <button type="button" className={ghostButton} disabled={!draft.name || busy !== null} onClick={() => void runPreview()}>
          {busy === "preview" ? "Checking..." : "Dry run"}
        </button>
        <button type="button" className={ghostButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function SettingsEditor({ settings, onSaved }: { settings: Settings; onSaved: () => void }) {
  const [draft, setDraft] = useState(settings);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => setDraft(settings), [settings]);

  const save = async () => {
    setStatus("Saving...");
    try {
      await api.saveSettings(draft);
      setStatus("Saved");
      onSaved();
    } catch (err) {
      setStatus((err as Error).message);
    }
  };

  const weekly = draft.weeklyScan;
  const setWeekly = (patch: Partial<Settings["weeklyScan"]>) => setDraft({ ...draft, weeklyScan: { ...weekly, ...patch } });

  return (
    <div className="space-y-3">
      <Field label="Workspace name">
        <input className={inputClass} value={draft.workspaceName} onChange={(event) => setDraft({ ...draft, workspaceName: event.target.value })} />
      </Field>
      <Field label="Themes" hint="Comma separated. Used for insights and route_signal.">
        <ListInput value={draft.themes} onChange={(themes) => setDraft({ ...draft, themes })} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={weekly.enabled} onChange={(event) => setWeekly({ enabled: event.target.checked })} />
        Weekly scan on
        <select
          className="rounded-lg border border-slate-200 px-2 py-1"
          value={weekly.dayOfWeek}
          onChange={(event) => setWeekly({ dayOfWeek: Number(event.target.value) })}
        >
          {DAYS.map((day, index) => (
            <option key={day} value={index}>
              {day}
            </option>
          ))}
        </select>
        at
        <select className="rounded-lg border border-slate-200 px-2 py-1" value={weekly.hour} onChange={(event) => setWeekly({ hour: Number(event.target.value) })}>
          {Array.from({ length: 24 }, (_, hour) => (
            <option key={hour} value={hour}>
              {`${hour}:00`}
            </option>
          ))}
        </select>
      </label>
      <Field label="Time zone" hint="Weekly scans only run while the server is running.">
        <input className={inputClass} value={weekly.timeZone} onChange={(event) => setWeekly({ timeZone: event.target.value })} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={draft.includeSynthetic} onChange={(event) => setDraft({ ...draft, includeSynthetic: event.target.checked })} />
        Include synthetic demo posts
      </label>
      <div className="flex items-center gap-3">
        <button type="button" className={primaryButton} onClick={() => void save()}>
          Save settings
        </button>
        {status ? <span className="text-sm text-slate-600">{status}</span> : null}
      </div>
    </div>
  );
}

function formatRun(run: ScanRun): string {
  const stored = Object.values(run.stats).reduce((sum, stats) => sum + stats.stored, 0);
  const when = new Date(run.startedAt).toLocaleString();
  return `${run.trigger} scan ${run.status}, ${stored} posts, ${when}`;
}

export function WatchlistPanel({
  open,
  config,
  onClose,
  onChanged,
  onScanned,
}: {
  open: boolean;
  config: RadarConfig | null;
  onClose: () => void;
  onChanged: () => void;
  onScanned: () => void;
}) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [editing, setEditing] = useState<{ entity: Entity; isNew: boolean } | null>(null);
  const [runs, setRuns] = useState<ScanRun[]>([]);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [token, setTokenState] = useState(getToken());

  useEffect(() => {
    if (!open) return;
    api.presets().then(setPresets).catch(() => setPresets([]));
    api
      .scanRuns()
      .then((result) => {
        setRuns(result.runs);
        setScanning(result.running);
      })
      .catch(() => setRuns([]));
  }, [open]);

  if (!open) return null;

  const act = async (label: string, action: () => Promise<unknown>) => {
    setMessage(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setMessage(`${label}: ${(err as Error).message}`);
    }
  };

  const scanNow = async () => {
    setScanning(true);
    setMessage("Scanning. About 5 seconds per company...");
    try {
      const run = await api.scan();
      setRuns((current) => [run, ...current]);
      setMessage(formatRun(run));
      onScanned();
    } catch (err) {
      setMessage(`Scan: ${(err as Error).message}`);
    } finally {
      setScanning(false);
    }
  };

  const entities = config?.entities ?? [];

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close watchlist" className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <aside className="relative h-full w-full max-w-xl overflow-y-auto bg-[#faf8ff] p-5 shadow-2xl sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold text-radar-ink">Watchlist</h2>
            <p className="mt-1 text-sm text-slate-600">
              Companies to monitor. Saved to {config?.storage === "postgres" ? "Neon" : "a local file"}.
            </p>
          </div>
          <button type="button" className={ghostButton} onClick={onClose}>
            Close
          </button>
        </div>

        {message ? <div className="mb-4 rounded-xl bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">{message}</div> : null}

        <section className="mb-6">
          <div className={labelClass}>Start from a preset</div>
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={preset.description}
                className={ghostButton}
                onClick={() => void act("Preset", () => api.applyPreset(preset.id))}
              >
                + {preset.name}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">Presets only add companies you don't already have.</p>
        </section>

        <section className="mb-6 space-y-2">
          <div className="flex items-center justify-between">
            <div className={labelClass}>Companies ({entities.length})</div>
            <button
              type="button"
              className={ghostButton}
              onClick={() => setEditing({ entity: { ...blankEntity(), role: entities.length ? "competitor" : "primary" }, isNew: true })}
            >
              + Add company
            </button>
          </div>

          {editing?.isNew ? (
            <EntityEditor
              initial={editing.entity}
              isNew
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                onChanged();
              }}
            />
          ) : null}

          {entities.length === 0 && !editing ? (
            <div className="rounded-2xl bg-white p-4 text-sm text-slate-600">No companies yet. Pick a preset or add one.</div>
          ) : null}

          {entities.map((entity) =>
            editing && !editing.isNew && editing.entity.id === entity.id ? (
              <EntityEditor
                key={entity.id}
                initial={entity}
                isNew={false}
                onCancel={() => setEditing(null)}
                onSaved={() => {
                  setEditing(null);
                  onChanged();
                }}
              />
            ) : (
              <div key={entity.id} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: entity.color }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={["font-semibold", entity.enabled ? "text-slate-800" : "text-slate-400 line-through"].join(" ")}>
                      {entity.name}
                    </span>
                    <span
                      className={[
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em]",
                        entity.role === "primary" ? "bg-violet-100 text-radar-purple" : "bg-slate-100 text-slate-600",
                      ].join(" ")}
                    >
                      {entity.role}
                    </span>
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {[entity.name, ...entity.aliases].join(" · ")}
                    {entity.sources.discourse.forums.length ? ` · ${entity.sources.discourse.forums.length} forum(s)` : ""}
                  </div>
                </div>
                <label className="flex items-center gap-1 text-xs text-slate-500" title="Include in scans">
                  <input
                    type="checkbox"
                    checked={entity.enabled}
                    onChange={(event) => void act("Toggle", () => api.saveEntity({ ...entity, enabled: event.target.checked }))}
                  />
                  on
                </label>
                <button type="button" className={ghostButton} onClick={() => setEditing({ entity, isNew: false })}>
                  Edit
                </button>
                <button
                  type="button"
                  className="rounded-full px-2 py-1.5 text-sm text-rose-600 hover:bg-rose-50"
                  onClick={() => {
                    if (window.confirm(`Remove ${entity.name} from the watchlist? Stored posts stay.`)) {
                      void act("Delete", () => api.deleteEntity(entity.id));
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            ),
          )}
        </section>

        <section className="mb-6 rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <div className={labelClass}>Scans</div>
            <button type="button" className={primaryButton} disabled={scanning || entities.length === 0} onClick={() => void scanNow()}>
              {scanning ? "Scanning..." : "Run scan now"}
            </button>
          </div>
          {runs.length === 0 ? (
            <p className="text-sm text-slate-500">No scans yet.</p>
          ) : (
            <ul className="space-y-1 text-sm text-slate-600">
              {runs.slice(0, 4).map((run) => (
                <li key={run.id}>{formatRun(run)}</li>
              ))}
            </ul>
          )}
        </section>

        {config ? (
          <section className="mb-6 rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm">
            <div className={`${labelClass} mb-3`}>Settings</div>
            <SettingsEditor settings={config.settings} onSaved={onChanged} />
          </section>
        ) : null}

        <details className="rounded-[24px] border border-slate-100 bg-white p-4 text-sm text-slate-600 shadow-sm">
          <summary className="cursor-pointer font-semibold text-slate-700">API token</summary>
          <p className="mt-2">Only needed if the server sets COMM_VOICES_API_TOKEN. Stored in this browser only.</p>
          <input
            type="password"
            className={`${inputClass} mt-2`}
            value={token}
            onChange={(event) => {
              setTokenState(event.target.value);
              setToken(event.target.value);
            }}
          />
        </details>
      </aside>
    </div>
  );
}
