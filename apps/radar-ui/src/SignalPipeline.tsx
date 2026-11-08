import { useCallback, useEffect, useState } from "react";

import {
  api,
  type Caps,
  type PipelineSettings,
  type RadarConfig,
  type ReviewPost,
  type ScoreSummary,
  type SignalClass,
} from "./api";

// Signal pipeline controls. Classify, score and decide run in one pass today
// ("Score now"). Engine: local rules (free, offline) or TypeSafe Jev (adapter
// not wired yet, so a Jev run falls back to rules and says so).

export const CLASS_LABELS: Record<SignalClass, string> = {
  question: "Question",
  feature_request: "Feature request",
  pain_point: "Pain point",
  discussion: "Discussion",
  churn_risk: "Churn risk",
  competitor_switch: "Competitor switch",
  security_outage: "Security / outage",
  praise: "Praise",
};

const EXTRA_CLASSES: SignalClass[] = ["churn_risk", "competitor_switch", "security_outage", "praise"];
const BASE_CLASSES: SignalClass[] = ["question", "feature_request", "pain_point", "discussion"];

const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500";
const primaryButton =
  "rounded-full bg-radar-purple px-4 py-2 text-sm font-semibold text-white transition hover:bg-radar-plum disabled:cursor-not-allowed disabled:opacity-60";
const ghostButton =
  "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-violet-200 hover:text-radar-purple disabled:opacity-60";

function describe(summary: ScoreSummary): string {
  const engines = Object.entries(summary.byEngine)
    .map(([engine, count]) => `${count} by ${engine}`)
    .join(", ");
  const parts = [`Scored ${summary.scored} of ${summary.considered} posts${engines ? ` (${engines})` : ""}.`];
  if (summary.capHit) parts.push(`Cap hit: ${summary.capHit}. The rest used local rules.`);
  if (summary.note) parts.push(`Note: ${summary.note}. Used local rules.`);
  if (summary.attempts) parts.push(`${summary.attempts} engine calls, ~${summary.reservedTokens} input tokens, $${summary.costUsd}.`);
  return parts.join(" ");
}

export function SignalPipelinePanel({
  open,
  config,
  onClose,
  onChanged,
  onScored,
}: {
  open: boolean;
  config: RadarConfig | null;
  onClose: () => void;
  onChanged: () => void;
  onScored: () => void;
}) {
  const [draft, setDraft] = useState<PipelineSettings | null>(config?.settings.pipeline ?? null);
  const [caps, setCaps] = useState<{ caps: Caps; jevKeySet: boolean } | null>(null);
  const [queue, setQueue] = useState<ReviewPost[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<"score" | "save" | null>(null);

  useEffect(() => {
    if (config) setDraft(config.settings.pipeline);
  }, [config]);

  const loadReview = useCallback(async () => {
    try {
      setQueue((await api.review()).posts);
    } catch {
      setQueue([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    api.caps().then(setCaps).catch(() => setCaps(null));
    void loadReview();
  }, [open, loadReview]);

  if (!open || !config || !draft) return null;

  const weights = draft.weights;
  const totalWeight = weights.urgency + weights.reach + weights.business;
  const pct = (value: number) => (totalWeight ? Math.round((value / totalWeight) * 100) : 0);

  const save = async () => {
    setBusy("save");
    setStatus(null);
    try {
      await api.saveSettings({ ...config.settings, pipeline: draft });
      setStatus("Saved.");
      onChanged();
    } catch (err) {
      setStatus((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const scoreNow = async () => {
    setBusy("score");
    setStatus("Scoring...");
    try {
      setStatus(describe(await api.scoreNow()));
      onScored();
      await loadReview();
    } catch (err) {
      setStatus(`Score: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const rate = async (postId: string, verdict: "right" | "wrong") => {
    setQueue((current) => current.filter((item) => item.id !== postId));
    try {
      await api.feedback(postId, verdict);
    } catch (err) {
      setStatus(`Feedback: ${(err as Error).message}`);
      void loadReview();
    }
  };

  const toggleClass = (name: SignalClass) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            extraClasses: current.extraClasses.includes(name)
              ? current.extraClasses.filter((existing) => existing !== name)
              : [...current.extraClasses, name],
          }
        : current,
    );

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close signal pipeline" className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <aside className="relative h-full w-full max-w-2xl overflow-y-auto bg-[#faf8ff] p-5 shadow-2xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold text-radar-ink">Signal pipeline</h2>
            <p className="mt-1 text-sm text-slate-600">Class, importance and confidence for every stored post.</p>
          </div>
          <button type="button" className={ghostButton} onClick={onClose}>
            Close
          </button>
        </div>

        {status ? <div className="mb-4 rounded-xl bg-white px-3 py-2 text-sm text-slate-700 shadow-sm">{status}</div> : null}

        {/* Engine + score now */}
        <section className="mb-5 rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className={labelClass}>Engine</div>
              <select
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm"
                value={draft.engine}
                onChange={(event) => setDraft({ ...draft, engine: event.target.value as PipelineSettings["engine"] })}
              >
                <option value="rules">Local rules (free, offline)</option>
                <option value="jev">TypeSafe Jev (adapter not wired yet)</option>
              </select>
            </div>
            <button type="button" className={primaryButton} disabled={busy !== null} onClick={() => void scoreNow()}>
              {busy === "score" ? "Scoring..." : "Score now"}
            </button>
          </div>
          {draft.engine === "jev" ? (
            <p className="text-xs text-amber-700">
              Jev isn't wired to its API yet. Posts are scored by local rules and labeled "rules-fallback".
              {caps && !caps.jevKeySet ? " TYPESAFE_API_KEY is not set on the server." : ""}
            </p>
          ) : null}
          {caps ? (
            <p className="mt-2 text-xs text-slate-500">
              Caps per run (set in <code>.env</code>): {caps.caps.maxAttempts} attempts, {caps.caps.maxInputTokens.toLocaleString()} input tokens, $
              {caps.caps.maxCostUsd}, {caps.caps.timeoutMs} ms timeout, {caps.caps.maxRetries} retries, {caps.caps.concurrency} parallel. When a cap is
              hit, the rest of the posts use local rules.
            </p>
          ) : null}
        </section>

        {/* Classes */}
        <section className="mb-5 rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm">
          <div className={labelClass}>Classes</div>
          <div className="flex flex-wrap gap-2">
            {BASE_CLASSES.map((name) => (
              <span key={name} className="rounded-full bg-slate-900 px-3 py-1 text-sm text-white">
                {CLASS_LABELS[name]}
              </span>
            ))}
            {EXTRA_CLASSES.map((name) => {
              const on = draft.extraClasses.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggleClass(name)}
                  className={[
                    "rounded-full border px-3 py-1 text-sm",
                    on ? "border-radar-purple bg-violet-50 text-radar-purple" : "border-slate-200 text-slate-400 line-through",
                  ].join(" ")}
                >
                  {CLASS_LABELS[name]}
                </button>
              );
            })}
            <span className="rounded-full border border-dashed border-slate-300 px-3 py-1 text-sm text-slate-400">+ custom class (later)</span>
          </div>
        </section>

        {/* Weights */}
        <section className="mb-5 rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm">
          <div className={labelClass}>Importance weights (urgency first)</div>
          {(
            [
              ["urgency", "Urgency"],
              ["reach", "Reach"],
              ["business", "Business impact"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="mb-2 flex items-center gap-3 text-sm text-slate-700">
              <span className="w-32">{label}</span>
              <input
                type="range"
                min={0}
                max={100}
                className="flex-1"
                value={weights[key]}
                onChange={(event) => setDraft({ ...draft, weights: { ...weights, [key]: Number(event.target.value) } })}
              />
              <span className="w-12 text-right font-semibold">{pct(weights[key])}%</span>
            </label>
          ))}
        </section>

        {/* Review threshold */}
        <section className="mb-5 rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm">
          <label className="flex items-center gap-3 text-sm text-slate-700">
            <span className={`${labelClass} mb-0`}>Review below confidence</span>
            <input
              type="range"
              min={0.1}
              max={0.9}
              step={0.05}
              className="flex-1"
              value={draft.reviewConfidence}
              onChange={(event) => setDraft({ ...draft, reviewConfidence: Number(event.target.value) })}
            />
            <span className="w-10 font-semibold">{draft.reviewConfidence.toFixed(2)}</span>
          </label>
        </section>

        <div className="mb-6 flex items-center gap-3">
          <button type="button" className={primaryButton} disabled={busy !== null} onClick={() => void save()}>
            {busy === "save" ? "Saving..." : "Save settings"}
          </button>
          <span className="text-xs text-slate-500">Saving changes how new posts are scored. Existing scores stay.</span>
        </div>

        {/* Review queue */}
        <section className="mb-6 rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm">
          <div className={`${labelClass} mb-2`}>Review queue ({queue.length})</div>
          {queue.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing to review. Run Score now, or lower the threshold you saved.</p>
          ) : (
            <ul className="space-y-2">
              {queue.map((item) => (
                <li key={item.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
                  <p className="text-sm text-slate-700">
                    {item.meta?.url ? (
                      <a href={item.meta.url} target="_blank" rel="noreferrer" className="hover:text-radar-purple hover:underline">
                        {item.content.slice(0, 200)}
                      </a>
                    ) : (
                      item.content.slice(0, 200)
                    )}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-slate-900 px-2 py-0.5 text-white">{CLASS_LABELS[item.signal.signalClass]}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">importance {item.signal.importance.toFixed(2)}</span>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">confidence {item.signal.confidence.toFixed(2)}</span>
                    <span className="text-slate-400">{item.signal.engine}</span>
                    <span className="ml-auto flex gap-1">
                      <button type="button" className={ghostButton} onClick={() => void rate(item.id, "right")}>
                        Right
                      </button>
                      <button type="button" className={ghostButton} onClick={() => void rate(item.id, "wrong")}>
                        Wrong
                      </button>
                    </span>
                  </div>
                  {item.signal.reasons.length ? <p className="mt-1 text-xs text-slate-500">{item.signal.reasons.join("; ")}</p> : null}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-500">Ratings are saved as labeled examples for comparing engines later.</p>
        </section>
      </aside>
    </div>
  );
}
