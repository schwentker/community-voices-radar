import { randomUUID } from "node:crypto";

import type { CommunityPost } from "./data/community-posts.js";
import type { Entity, Settings } from "./config/schema.js";
import { buildRedditQuery, matchEntities } from "./config/query.js";
import { fetchForumTopics } from "./sources/discourse.js";
import { searchReddit, type FetchLike } from "./sources/reddit.js";
import type { EntityScanStats, ScanRun, ScanTrigger, Store } from "./store/types.js";

// Scan runner: for each enabled company, derive queries from the watchlist,
// fetch, classify, tag with every company the post mentions, persist.
// Runs one at a time (single-flight), on demand or from the weekly schedule.

export interface ScanOptions {
  entityIds?: string[];
  redditPages?: number;
  pageSize?: number;
  delayMs?: number;
  fetchImpl?: FetchLike;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let inFlight: Promise<ScanRun> | null = null;

export function isScanRunning(): boolean {
  return inFlight !== null;
}

export function runScan(store: Store, trigger: ScanTrigger, options: ScanOptions = {}): Promise<ScanRun> {
  if (!inFlight) {
    inFlight = doScan(store, trigger, options).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function fetchForEntity(
  entity: Entity,
  options: Required<Omit<ScanOptions, "entityIds">>,
  stats: EntityScanStats,
): Promise<CommunityPost[]> {
  const posts: CommunityPost[] = [];

  if (entity.sources.reddit.enabled) {
    let after: string | null = null;
    for (let page = 0; page < options.redditPages; page += 1) {
      const result = await searchReddit(stats.query, {
        limit: options.pageSize,
        after,
        painKeywords: entity.painKeywords,
        fetchImpl: options.fetchImpl,
      });
      if (result.status !== "ok") stats.errors.push(`reddit: ${result.status}`);
      posts.push(...result.posts);
      after = result.after;
      if (!after || result.status !== "ok") break;
      await sleep(options.delayMs); // stay under Reddit's unauthenticated rate limit
    }
  }

  for (const forum of entity.sources.discourse.forums) {
    posts.push(
      ...(await fetchForumTopics(forum, {
        limit: options.pageSize,
        painKeywords: entity.painKeywords,
        fetchImpl: options.fetchImpl,
      })),
    );
  }

  return posts;
}

async function doScan(store: Store, trigger: ScanTrigger, options: ScanOptions): Promise<ScanRun> {
  const { entities } = await store.getConfig();
  const targets = entities.filter(
    (entity) => entity.enabled && (!options.entityIds || options.entityIds.includes(entity.id)),
  );
  const resolved = {
    redditPages: options.redditPages ?? 2,
    pageSize: options.pageSize ?? 25,
    delayMs: options.delayMs ?? 1500,
    fetchImpl: options.fetchImpl ?? fetch,
  };

  const run: ScanRun = {
    id: randomUUID(),
    trigger,
    startedAt: new Date().toISOString(),
    status: "running",
    stats: {},
  };
  await store.saveScanRun(run);

  for (const entity of targets) {
    const stats: EntityScanStats = { query: buildRedditQuery(entity), fetched: 0, stored: 0, errors: [] };
    run.stats[entity.id] = stats;

    try {
      const posts = await fetchForEntity(entity, resolved, stats);
      stats.fetched = posts.length;

      for (const post of posts) {
        // Tag with the entity that found it plus any other company it names
        // (a "Shopify vs Woo" thread counts for both).
        const tags = new Set([entity.id, ...matchEntities(post.content, entities)]);
        try {
          await store.savePost(post, [...tags]);
          stats.stored += 1;
        } catch (error) {
          stats.errors.push(`store ${post.id}: ${(error as Error).message}`);
        }
      }
    } catch (error) {
      stats.errors.push((error as Error).message);
    }

    if (resolved.delayMs > 0) await sleep(resolved.delayMs);
  }

  const statsList = Object.values(run.stats);
  const failed = statsList.filter((stats) => stats.errors.length > 0).length;
  run.status = failed === 0 ? "ok" : failed === statsList.length ? "error" : "partial";
  run.finishedAt = new Date().toISOString();
  await store.saveScanRun(run);
  console.log(`[scan] ${trigger} scan ${run.status}: ${statsList.map((s) => s.stored).reduce((a, b) => a + b, 0)} posts`);
  return run;
}

// ── Weekly schedule ─────────────────────────────────────────────────────────

function zonedParts(now: Date, timeZone: string): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekdayName = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName), hour };
}

/** Pure check: is the weekly scan due now? Due once per week, at or after the configured hour. */
export function isWeeklyScanDue(now: Date, schedule: Settings["weeklyScan"], lastWeeklyRunAt: Date | null): boolean {
  if (!schedule.enabled) return false;
  const { weekday, hour } = zonedParts(now, schedule.timeZone);
  if (weekday !== schedule.dayOfWeek || hour < schedule.hour) return false;
  if (!lastWeeklyRunAt) return true;
  return now.getTime() - lastWeeklyRunAt.getTime() > 2 * 86_400_000;
}

/** Checks every 15 minutes. Runs only while the server is up. */
export function startWeeklySchedule(store: Store, intervalMs = 15 * 60_000): NodeJS.Timeout {
  const tick = async () => {
    try {
      const { settings } = await store.getConfig();
      const [last] = await store.listScanRuns(1, "weekly");
      if (isWeeklyScanDue(new Date(), settings.weeklyScan, last ? new Date(last.startedAt) : null)) {
        await runScan(store, "weekly");
      }
    } catch (error) {
      console.error("[scan] Weekly schedule check failed", error);
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return timer;
}
