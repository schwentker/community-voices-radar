# Roadmap

## Now: watchlist (done)
Companies to monitor, presets, dry run, on-demand and weekly scans.

## Next: signal pipeline (mockup first)
Goal: with a firehose of 1k to 10k posts a day, raise the **importance**, **confidence** and **class** of each signal.

Pipeline, cheapest stage first. Every stage emits a score and a confidence. Low confidence escalates or goes to a human review queue.

1. **Classify**: what kind of post is it? Starting classes: question, feature request, pain point, discussion, plus churn risk, competitor switch, security or outage, praise. Custom classes later.
2. **Score**: how important is it? Ranked by urgency, then reach, then business impact (weights editable).
3. **Decide**: what to do? Digest, alert, dashboard, or hand to an agent.

Outputs, in priority order: ranked digest, real-time alerts, dashboards and trends, structured feed for agents (MCP).

Controls (separate "Signal pipeline" panel, with per-company overrides on the watchlist):
- provider per stage
- cost and latency budget per stage
- review-confidence threshold
- review queue with thumbs up/down

v1 provider: **TypeSafe Jev** (`JEV_*` settings in `.env`). Other providers stay mocked.

## Later
- **Decision-engine router.** Pick the best engine per item or per stage. Policies: cheapest that clears the confidence bar; by classification type; fallback chain. Candidates: TypeSafe Jev, Cloudflare Clef, Parallel Decisions API (docs: https://docs.parallel.ai/decisions/decisions-quickstart.md), plain rules.
- Custom class taxonomy editor.
- Feedback loop: review-queue thumbs become labeled examples to evaluate engines and tune thresholds.
- Slack and Discord connectors.
