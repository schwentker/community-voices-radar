import { resolve } from "node:path";

import { MemoryStore } from "./memory.js";
import { PostgresStore } from "./postgres.js";
import type { Store } from "./types.js";

export type { Store } from "./types.js";

export function createStore(env: NodeJS.ProcessEnv = process.env): Store {
  if (env["DATABASE_URL"]) {
    return new PostgresStore();
  }
  const path = resolve(env["WATCHLIST_FILE"] ?? "data/watchlist.local.json");
  console.warn(`[store] DATABASE_URL not set: watchlist saved to ${path}, posts kept in memory only.`);
  return new MemoryStore(path);
}
