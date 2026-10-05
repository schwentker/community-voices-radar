# Community Voices Radar

![status: early concept](https://img.shields.io/badge/status-early%20concept-orange) ![MCP](https://img.shields.io/badge/MCP-server-6b4fbb) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6) ![Fly.io + Neon](https://img.shields.io/badge/deploy-Fly.io%20%2B%20Neon-8b5cf6)

**MCP server giving AI agents real-time access to builder communities: Reddit, Slack, Discourse, Discord.**

Aggregates posts → normalized schema → MCP tools. Deployed on Fly.io with Neon (serverless Postgres).

Connect it to Claude (or any MCP client) and ask:

> *"What are developers asking this week?"*
> *"Show me feature requests from Europe."*
> *"Flag unanswered questions from the last 48 hours."*
> *"Which integration pain points are trending, and where should they be routed?"*

## Example session

```text
You:    What are developers asking this week?
Agent:  → get_community_posts(type="question", limit=20)
        12 questions across Reddit, Discourse, Discord. Top themes:
        auth for remote MCP servers (4), rate limits on tool calls (3),
        Postgres connection pooling on serverless (2).
        → route_signal(type="integration_pain")
        Recommended: escalate auth issues to engineering.
```

> **Status: early concept.** Server, MCP tools, Reddit and Discourse ingestion run today; Slack and Discord use a sample feed while connectors are built. Point it at any product, framework, or community via env vars.

---

## Why

Builder communities are spread across platforms. Questions go unanswered on one, feature requests sit in a thread on another, and regional voices get drowned out by the loudest channel. Community Voices Radar listens everywhere, normalizes what it hears, and makes it queryable in plain language by an agent, so community signal can be treated like product telemetry.

Design principle: **aggregate first, decide later.** Don't force a community onto one platform; ingest from all of them and let the insights travel.

---

## Architecture

```
Claude / any MCP client
        │
        ▼ MCP (SSE)
community-voices-radar (Fly.io)
        │
        ├── Sources
        │       ├── Reddit search      (live, REDDIT_SEARCH_QUERY)
        │       ├── Discourse forums   (live, DISCOURSE_BASE_URLS)
        │       ├── Slack              (synthetic sample, connector planned)
        │       └── Discord            (synthetic sample, connector planned)
        │
        ├── Normalizer  → CommunityPost schema
        │
        ├── MCP tools
        │       ├── get_community_posts
        │       └── route_signal
        │
        ├── HTTP
        │       ├── GET /health
        │       ├── GET /community-posts
        │       └── GET /insights/acknowledged
        │
        └── Neon Postgres  (posts, members, post_tags)
```

---

## MCP tools

**`get_community_posts`**: recent posts across all channels.

| Parameter | Type | Options |
|-----------|------|---------|
| platform | string | reddit, slack, discourse, discord, all |
| region | string | us, europe, india, japan, brazil, unknown, all |
| type | string | question, feature_request, integration_pain, discussion, announcement, all |
| limit | integer | 1-100 |

**`route_signal`**: ranks stored posts by engagement, detects themes, and recommends a routing action (product backlog vs engineering escalation). If `SIGNAL_WEBHOOK_URL` is set, the top signals are POSTed there (Slack incoming webhook, n8n, Zapier, or your own service).

---

## Normalized schema

Every post, regardless of source, becomes:

```typescript
{
  id: string
  external_id: string
  platform: "reddit" | "slack" | "discourse" | "discord"
  author: string
  region: "us" | "europe" | "india" | "japan" | "brazil" | "unknown"
  content: string
  type: "question" | "feature_request" | "integration_pain" | "discussion" | "announcement"
  timestamp: string   // ISO 8601
  source?: string     // e.g. reddit_live, discourse_live, synthetic
  meta?: Record<string, unknown>
}
```

---

## Stack

- **Runtime**: Node.js 20, TypeScript
- **MCP**: `@modelcontextprotocol/sdk`, SSE transport
- **Database**: Neon serverless Postgres via `postgres.js`
- **Deploy**: Fly.io (persistent SSE connections)
- **UI**: optional React + Vite + Tailwind dashboard in `apps/radar-ui`

---

## Local setup

```bash
git clone https://github.com/schwentker/community-voices-radar
cd community-voices-radar
nvm use 20
npm install
cp .env.example .env      # set DATABASE_URL, REDDIT_SEARCH_QUERY, DISCOURSE_BASE_URLS
npm run db:setup
npm run dev
```

Inspect with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
# connect to http://localhost:3000/sse
```

## Deploy (Fly.io + Neon)

```bash
fly launch --no-deploy            # uses fly.toml
fly secrets set DATABASE_URL="postgresql://..." COMM_VOICES_API_TOKEN="..."
fly deploy
```

## Connect to Claude Desktop

```json
{
  "mcpServers": {
    "community-voices-radar": {
      "url": "https://<your-app>.fly.dev/sse",
      "headers": { "Authorization": "Bearer YOUR_COMM_VOICES_API_TOKEN" }
    }
  }
}
```

---

## Roadmap

- [ ] Slack connector (channel history via Slack API / Slack MCP)
- [ ] Discord connector (bot + message content intent)
- [ ] Streamable HTTP transport alongside SSE
- [ ] LLM classification of post type, sentiment, and region (MCP sampling)
- [ ] Unanswered-question detection across platforms
- [ ] Contributor scoring (cross-platform activity index)
- [ ] Weekly community digest

---

*Built by [Robert Schwentker](https://linkedin.com/in/schwentker), Sandbox Labs AI · Stack: TypeScript · MCP · Neon · Fly.io*
