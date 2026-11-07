import { useMemo, useState } from "react";

// MOCKUP. Nothing here calls a provider or the server. It shows the controls
// for a future signal pipeline (classify -> score -> decide) so the shape can
// be judged before building. Defaults mirror the JEV_* values in .env.

type Provider = "jev" | "clef" | "parallel" | "rules";
type StageId = "classify" | "score" | "decide";
type Output = "digest" | "alerts" | "dashboards" | "feed";

const PROVIDERS: { id: Provider; label: string; live: boolean; note: string }[] = [
  { id: "jev", label: "TypeSafe Jev", live: true, note: "v1 provider" },
  { id: "clef", label: "Cloudflare Clef", live: false, note: "later" },
  { id: "parallel", label: "Parallel Decisions", live: false, note: "later" },
  { id: "rules", label: "Local rules", live: false, note: "later" },
];

const CLASSES_NOW = ["question", "feature request", "pain point", "discussion"];
const CLASSES_NEXT = ["churn risk", "competitor switch", "security / outage", "praise"];

const OUTPUTS: { id: Output; label: string; live: boolean }[] = [
  { id: "digest", label: "Ranked digest", live: true },
  { id: "alerts", label: "Alerts", live: true },
  { id: "dashboards", label: "Dashboards", live: true },
  { id: "feed", label: "Agent feed (MCP)", live: false },
];

const SAMPLE_QUEUE = [
  { id: "q1", text: "Moving 3 stores off Shopify next month, checkout fees are killing us", cls: "churn risk", confidence: 0.41, importance: "high" },
  { id: "q2", text: "Is there a way to bulk edit metafields without the API?", cls: "question", confidence: 0.47, importance: "low" },
  { id: "q3", text: "Webhook deliveries stopped for about two hours this morning", cls: "security / outage", confidence: 0.38, importance: "high" },
];

const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500";
const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100";

interface StageState {
  provider: Provider;
  maxCostUsd: number;
  timeoutMs: number;
  maxAttempts: number;
}

const STAGES: { id: StageId; title: string; blurb: string }[] = [
  { id: "classify", title: "1. Classify", blurb: "What kind of post is it?" },
  { id: "score", title: "2. Score", blurb: "How important is it, and how sure are we?" },
  { id: "decide", title: "3. Decide", blurb: "What should happen to it?" },
];

export function SignalPipelinePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [stages, setStages] = useState<Record<StageId, StageState>>({
    classify: { provider: "jev", maxCostUsd: 1, timeoutMs: 10000, maxAttempts: 4000 },
    score: { provider: "jev", maxCostUsd: 1, timeoutMs: 10000, maxAttempts: 4000 },
    decide: { provider: "jev", maxCostUsd: 1, timeoutMs: 10000, maxAttempts: 4000 },
  });
  const [weights, setWeights] = useState({ urgency: 50, reach: 30, business: 20 });
  const [reviewAt, setReviewAt] = useState(0.5);
  const [nextClasses, setNextClasses] = useState<Record<string, boolean>>(
    Object.fromEntries(CLASSES_NEXT.map((name) => [name, true]))
  );
  const [outputs, setOutputs] = useState<Record<Output, boolean>>({ digest: true, alerts: true, dashboards: true, feed: false });
  const [verdicts, setVerdicts] = useState<Record<string, "up" | "down">>({});

  const queue = useMemo(() => SAMPLE_QUEUE.filter((item) => item.confidence < reviewAt), [reviewAt]);
  const totalWeight = weights.urgency + weights.reach + weights.business;

  if (!open) return null;

  const setStage = (id: StageId, patch: Partial<StageState>) =>
    setStages((current) => ({ ...current, [id]: { ...current[id], ...patch } }));

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close signal pipeline" className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <aside className="relative h-full w-full max-w-2xl overflow-y-auto bg-[#faf8ff] p-5 shadow-2xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold text-radar-ink">Signal pipeline</h2>
            <p className="mt-1 text-sm text-slate-600">Raise the class, importance and confidence of each signal.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-violet-200"
          >
            Close
          </button>
        </div>

        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Mockup. Controls don't save or call any provider yet. Defaults come from the JEV_* values in <code>.env</code>.
        </div>

        {/* Funnel */}
        <section className="mb-6">
          <div className={labelClass}>Funnel: cheapest stage first, low confidence escalates</div>
          <div className="space-y-3">
            {STAGES.map((stage) => {
              const state = stages[stage.id];
              return (
                <div key={stage.id} className="rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-800">{stage.title}</div>
                      <div className="text-sm text-slate-500">{stage.blurb}</div>
                    </div>
                    <select
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm"
                      value={state.provider}
                      onChange={(event) => setStage(stage.id, { provider: event.target.value as Provider })}
                    >
                      {PROVIDERS.map((provider) => (
                        <option key={provider.id} value={provider.id} disabled={!provider.live}>
                          {provider.label} ({provider.note})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label>
                      <span className={labelClass}>Max cost / run (USD)</span>
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        className={inputClass}
                        value={state.maxCostUsd}
                        onChange={(event) => setStage(stage.id, { maxCostUsd: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      <span className={labelClass}>Timeout (ms)</span>
                      <input
                        type="number"
                        min={500}
                        step={500}
                        className={inputClass}
                        value={state.timeoutMs}
                        onChange={(event) => setStage(stage.id, { timeoutMs: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      <span className={labelClass}>Max attempts / run</span>
                      <input
                        type="number"
                        min={1}
                        step={100}
                        className={inputClass}
                        value={state.maxAttempts}
                        onChange={(event) => setStage(stage.id, { maxAttempts: Number(event.target.value) })}
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Later: a router that picks the engine per item (cheapest that clears the bar, or by classification type). See roadmap.md.
          </p>
        </section>

        {/* Classes */}
        <section className="mb-6 rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm">
          <div className={labelClass}>Classes</div>
          <div className="mb-2 flex flex-wrap gap-2">
            {CLASSES_NOW.map((name) => (
              <span key={name} className="rounded-full bg-slate-900 px-3 py-1 text-sm text-white">
                {name}
              </span>
            ))}
            {CLASSES_NEXT.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setNextClasses((current) => ({ ...current, [name]: !current[name] }))}
                className={[
                  "rounded-full border px-3 py-1 text-sm",
                  nextClasses[name] ? "border-radar-purple bg-violet-50 text-radar-purple" : "border-slate-200 text-slate-400 line-through",
                ].join(" ")}
              >
                {name}
              </button>
            ))}
            <span className="rounded-full border border-dashed border-slate-300 px-3 py-1 text-sm text-slate-400" title="Planned">
              + custom class (later)
            </span>
          </div>
        </section>

        {/* Importance weights */}
        <section className="mb-6 rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm">
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
                onChange={(event) => setWeights((current) => ({ ...current, [key]: Number(event.target.value) }))}
              />
              <span className="w-12 text-right font-semibold">{totalWeight ? Math.round((weights[key] / totalWeight) * 100) : 0}%</span>
            </label>
          ))}
        </section>

        {/* Outputs */}
        <section className="mb-6 rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm">
          <div className={labelClass}>Outputs (in priority order)</div>
          <div className="flex flex-wrap gap-2">
            {OUTPUTS.map((output, index) => (
              <label
                key={output.id}
                className={[
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm",
                  output.live ? "border-slate-200 text-slate-700" : "border-dashed border-slate-300 text-slate-400",
                ].join(" ")}
              >
                <input
                  type="checkbox"
                  disabled={!output.live}
                  checked={outputs[output.id]}
                  onChange={(event) => setOutputs((current) => ({ ...current, [output.id]: event.target.checked }))}
                />
                {index + 1}. {output.label}
                {!output.live ? " (later)" : ""}
              </label>
            ))}
          </div>
        </section>

        {/* Review queue */}
        <section className="mb-6 rounded-[24px] border border-slate-100 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className={labelClass}>Human review queue</div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Review below
              <input
                type="range"
                min={0.1}
                max={0.9}
                step={0.05}
                value={reviewAt}
                onChange={(event) => setReviewAt(Number(event.target.value))}
              />
              <span className="w-10 font-semibold">{reviewAt.toFixed(2)}</span>
            </label>
          </div>
          {queue.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing under this confidence. Raise the threshold to see items.</p>
          ) : (
            <ul className="space-y-2">
              {queue.map((item) => (
                <li key={item.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
                  <p className="text-sm text-slate-700">{item.text}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-slate-900 px-2 py-0.5 text-white">{item.cls}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">importance: {item.importance}</span>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">confidence {item.confidence.toFixed(2)}</span>
                    <span className="ml-auto flex gap-1">
                      {(["up", "down"] as const).map((verdict) => (
                        <button
                          key={verdict}
                          type="button"
                          onClick={() => setVerdicts((current) => ({ ...current, [item.id]: verdict }))}
                          className={[
                            "rounded-full border px-2.5 py-1",
                            verdicts[item.id] === verdict ? "border-radar-purple bg-radar-purple text-white" : "border-slate-200 bg-white text-slate-600",
                          ].join(" ")}
                        >
                          {verdict === "up" ? "Right" : "Wrong"}
                        </button>
                      ))}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-500">Sample items. Ratings become labeled examples to compare engines later.</p>
        </section>
      </aside>
    </div>
  );
}
