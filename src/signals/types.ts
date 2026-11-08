import type { PipelineSettings, SignalClass } from "../config/schema.js";

// A Decider turns one post into a verdict: class, importance, confidence.
// Engines (local rules, TypeSafe Jev, later Clef) implement this one interface,
// so the runner, caps and storage never know which engine ran (Strategy pattern).

export interface SignalInput {
  postId: string;
  text: string;
  platform: string;
  postType: string;
  company: string | null;
  otherCompanies: string[];
  ageHours: number;
  rank: number;
  painKeywords: string[];
}

export interface Verdict {
  signalClass: SignalClass;
  /** 0 to 1 */
  importance: number;
  /** 0 to 1 */
  confidence: number;
  reasons: string[];
  usage?: { inputTokens: number; costUsd: number };
}

export interface DeciderContext {
  weights: PipelineSettings["weights"];
  allowedClasses: SignalClass[];
  signal: AbortSignal;
}

export interface Decider {
  readonly name: string;
  decide(input: SignalInput, context: DeciderContext): Promise<Verdict>;
}

export type StoredSignal = Verdict & {
  engine: string;
  scoredAt: string;
  feedback?: "right" | "wrong";
};

/** Thrown when an engine can't run at all (missing key, adapter not wired). Never retried. */
export class NotConfiguredError extends Error {}
/** Thrown when a hard cap is reached. Remaining posts fall back to local rules. */
export class BudgetExceededError extends Error {}
