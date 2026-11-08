import type { Entity } from "../config/schema.js";
import { JevDecider } from "./jev.js";
import { RulesDecider } from "./rules.js";
import {
  BudgetExceededError,
  NotConfiguredError,
  type Decider,
  type SignalInput,
  type StoredSignal,
} from "./types.js";
import type { Store, StoredPost } from "../store/types.js";

// Scoring run: pick unscored posts, send each to the chosen engine under hard
// caps, store verdicts. When a cap is hit or the engine can't run, the rest of
// the posts are scored by the local rules engine (engine = "rules-fallback")
// instead of being left unscored.

export interface Caps {
  concurrency: number;
  maxAttempts: number;
  maxInputTokens: number;
  maxCostUsd: number;
  timeoutMs: number;
  maxRetries: number;
  maxStateChars: number;
}

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export function capsFromEnv(env: NodeJS.ProcessEnv = process.env): Caps {
  return {
    concurrency: Math.max(1, num(env["JEV_CONCURRENCY"], 8)),
    maxAttempts: num(env["JEV_MAX_ATTEMPTS_PER_RUN"], 4000),
    maxInputTokens: num(env["JEV_MAX_INPUT_TOKENS_PER_RUN"], 20_000_000),
    maxCostUsd: num(env["JEV_MAX_COST_USD_PER_RUN"], 1),
    timeoutMs: Math.max(100, num(env["JEV_TIMEOUT_MS"], 10_000)),
    maxRetries: num(env["JEV_MAX_RETRIES"], 2),
    maxStateChars: Math.max(100, num(env["JEV_MAX_STATE_CHARS"], 2000)),
  };
}

/**
 * Hard caps per run. Attempts and tokens are reserved BEFORE each try
 * (retries included), so a failing call can't overspend. Unknown usage stays charged.
 */
export class Budget {
  attempts = 0;
  reservedTokens = 0;
  costUsd = 0;

  constructor(private readonly caps: Caps) {}

  reserve(estimatedTokens: number): void {
    if (this.attempts + 1 > this.caps.maxAttempts) throw new BudgetExceededError("max attempts per run");
    if (this.reservedTokens + estimatedTokens > this.caps.maxInputTokens) throw new BudgetExceededError("max input tokens per run");
    if (this.costUsd >= this.caps.maxCostUsd) throw new BudgetExceededError("max cost per run");
    this.attempts += 1;
    this.reservedTokens += estimatedTokens;
  }

  charge(costUsd: number): void {
    this.costUsd += costUsd;
  }
}

export interface ScoreSummary {
  considered: number;
  scored: number;
  byEngine: Record<string, number>;
  capHit: string | null;
  note: string | null;
  attempts: number;
  reservedTokens: number;
  costUsd: number;
}

export interface ScoreOptions {
  limit?: number;
  caps?: Caps;
  primary?: Decider;
  fallback?: Decider;
  now?: () => Date;
}

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([run(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

function buildInput(post: StoredPost, entities: Entity[], maxChars: number, now: Date): SignalInput {
  const mine = entities.filter((entity) => post.entities.includes(entity.id));
  const primary = mine.find((entity) => entity.role === "primary") ?? mine[0];
  const rank = typeof post.meta?.["rank"] === "number" ? (post.meta["rank"] as number) : 0;
  return {
    postId: post.id,
    text: post.content.slice(0, maxChars),
    platform: post.platform,
    postType: post.type,
    company: primary?.name ?? null,
    otherCompanies: mine.filter((entity) => entity !== primary).map((entity) => entity.name),
    ageHours: Math.max(0, (now.getTime() - Date.parse(post.timestamp)) / 3_600_000),
    rank,
    painKeywords: mine.flatMap((entity) => entity.painKeywords),
  };
}

export async function scorePosts(store: Store, options: ScoreOptions = {}): Promise<ScoreSummary> {
  const caps = options.caps ?? capsFromEnv();
  const { settings, entities } = await store.getConfig();
  const pipeline = settings.pipeline;
  const rules = options.fallback ?? new RulesDecider();
  const primary: Decider = options.primary ?? (pipeline.engine === "jev" ? new JevDecider() : rules);
  const now = options.now?.() ?? new Date();
  const budget = new Budget(caps);

  const posts = await store.listUnscored(options.limit ?? 500);
  const summary: ScoreSummary = {
    considered: posts.length,
    scored: 0,
    byEngine: {},
    capHit: null,
    note: null,
    attempts: 0,
    reservedTokens: 0,
    costUsd: 0,
  };

  const baseContext = { weights: pipeline.weights, allowedClasses: pipeline.extraClasses };
  let useFallbackOnly = primary === rules;
  const record = (engine: string) => {
    summary.byEngine[engine] = (summary.byEngine[engine] ?? 0) + 1;
    summary.scored += 1;
  };

  const scoreOne = async (post: StoredPost): Promise<void> => {
    const input = buildInput(post, entities, caps.maxStateChars, now);
    let engine = primary.name;
    let verdict: StoredSignal | null = null;

    if (!useFallbackOnly) {
      for (let attempt = 0; attempt <= caps.maxRetries; attempt += 1) {
        try {
          budget.reserve(estimateTokens(input.text));
          const result = await withTimeout((signal) => primary.decide(input, { ...baseContext, signal }), caps.timeoutMs);
          budget.charge(result.usage?.costUsd ?? 0);
          verdict = { ...result, engine, scoredAt: now.toISOString() };
          break;
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            summary.capHit ??= error.message;
            useFallbackOnly = true;
            break;
          }
          if (error instanceof NotConfiguredError) {
            summary.note ??= error.message;
            useFallbackOnly = true;
            break;
          }
          // transient failure: loop retries
        }
      }
    }

    if (!verdict) {
      engine = primary === rules ? rules.name : "rules-fallback";
      const result = await rules.decide(input, { ...baseContext, signal: new AbortController().signal });
      verdict = { ...result, engine, scoredAt: now.toISOString() };
    }

    await store.saveSignal(post.id, verdict);
    record(engine);
  };

  // Simple worker pool: `concurrency` workers pull from a shared index.
  let next = 0;
  const workers = Array.from({ length: Math.min(caps.concurrency, posts.length) }, async () => {
    while (next < posts.length) {
      const post = posts[next];
      next += 1;
      if (post) await scoreOne(post);
    }
  });
  await Promise.all(workers);

  summary.attempts = budget.attempts;
  summary.reservedTokens = budget.reservedTokens;
  summary.costUsd = Number(budget.costUsd.toFixed(4));
  return summary;
}
