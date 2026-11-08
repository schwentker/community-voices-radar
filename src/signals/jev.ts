import { NotConfiguredError, type Decider, type DeciderContext, type SignalInput, type Verdict } from "./types.js";

// TypeSafe Jev adapter: NOT wired yet. The request and response shape needs
// the TypeSafe docs; guessing it would fail on the first live run. Until then
// this reports "not configured" and the runner falls back to local rules.
//
// When wiring: map SignalInput to Jev's state + typed questions (class: choice,
// importance: score, confidence: from answer probabilities), send
// input.text clipped to JEV_MAX_STATE_CHARS, honor context.signal for timeouts,
// and return usage { inputTokens, costUsd } so the runner can enforce caps.

export class JevDecider implements Decider {
  readonly name = "jev";

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async decide(_input: SignalInput, _context: DeciderContext): Promise<Verdict> {
    if (!this.env["TYPESAFE_API_KEY"]) {
      throw new NotConfiguredError("TYPESAFE_API_KEY is not set");
    }
    throw new NotConfiguredError("Jev adapter not wired yet: needs the TypeSafe API request/response shape");
  }
}
