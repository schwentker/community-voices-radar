import { entitySchema, type Entity } from "../config/schema.js";

// Migration path off the old env-only config: on first boot, the old
// REDDIT_SEARCH_QUERY / DISCOURSE_BASE_URLS become one "default" entity.
// After that the watchlist in storage wins and the env vars are ignored.

export function entitiesFromEnv(env: NodeJS.ProcessEnv = process.env): Entity[] {
  const query = env["REDDIT_SEARCH_QUERY"]?.trim();
  const forums = (env["DISCOURSE_BASE_URLS"] ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.startsWith("https://"))
    // .env.example ships placeholder forums; never seed those.
    .filter((url) => !/(^|\.)example\.(com|org)(\/|$)/.test(new URL(url).host + "/"));

  if (!query && forums.length === 0) {
    return [];
  }

  return [
    entitySchema.parse({
      id: "default",
      name: "Default watch",
      role: "primary",
      sources: {
        reddit: { enabled: Boolean(query), ...(query ? { query } : {}) },
        discourse: { forums },
      },
    }),
  ];
}
