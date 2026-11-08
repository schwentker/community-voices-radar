import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { COMMUNITY_PLATFORMS, COMMUNITY_REGIONS, COMMUNITY_TYPES } from "../data/community-posts.js";
import { entitySchema, settingsSchema, ENTITY_ID_PATTERN } from "../config/schema.js";
import { PRESETS, findPreset } from "../config/presets.js";
import { buildRedditQuery } from "../config/query.js";
import { searchReddit } from "../sources/reddit.js";
import { getCommunityPosts } from "../sources/community-posts.js";
import { isScanRunning, runScan } from "../scan.js";
import { capsFromEnv, scorePosts } from "../signals/runner.js";
import type { Store } from "../store/types.js";

// REST API for the radar UI. Reads are open (CORS *). Writes need:
//  - an allowed Origin (blocks a random web page from POSTing to localhost), and
//  - the bearer token when COMM_VOICES_API_TOKEN is set, or a loopback caller when it is not.

export interface ApiOptions {
  apiToken: string | undefined;
  allowedOrigins: string[];
}

function pick<T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  return typeof value === "string" && allowed.includes(value) ? (value as T[number]) : ("all" as T[number]);
}

function isLoopback(ip: string | undefined): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

// Any localhost port counts as trusted, so a busy 5173 never breaks the panel.
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function createApiRouter(store: Store, options: ApiOptions): Router {
  const router = Router();
  const isAllowedOrigin = (origin: string) => LOCAL_ORIGIN.test(origin) || options.allowedOrigins.includes(origin);

  router.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.header("origin");
    const trusted = origin !== undefined && isAllowedOrigin(origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Origin", trusted ? origin : "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", trusted ? "GET, POST, PUT, DELETE, OPTIONS" : "GET, OPTIONS");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  const requireWrite = (req: Request, res: Response, next: NextFunction) => {
    const origin = req.header("origin");
    if (origin !== undefined && !isAllowedOrigin(origin)) {
      res.status(403).json({ error: `Origin ${origin} not allowed. Add it to CORS_ORIGINS.` });
      return;
    }
    if (options.apiToken) {
      if (req.header("authorization") !== `Bearer ${options.apiToken}`) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    } else if (!isLoopback(req.socket.remoteAddress)) {
      res.status(403).json({ error: "Config writes are local-only unless COMM_VOICES_API_TOKEN is set." });
      return;
    }
    next();
  };

  const wrap =
    (handler: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) =>
      handler(req, res).catch(next);

  // ── Posts ───────────────────────────────────────────────────────────────
  router.get(
    "/community-posts",
    wrap(async (req, res) => {
      const limit = Number.parseInt(String(req.query["limit"] ?? ""), 10);
      const days = Number.parseInt(String(req.query["days"] ?? ""), 10);
      const entity = typeof req.query["entity"] === "string" && req.query["entity"] !== "all" ? req.query["entity"] : undefined;
      const posts = await getCommunityPosts(store, {
        platform: pick(req.query["platform"], COMMUNITY_PLATFORMS),
        region: pick(req.query["region"], COMMUNITY_REGIONS),
        type: pick(req.query["type"], COMMUNITY_TYPES),
        ...(entity ? { entity } : {}),
        ...(limit > 0 ? { limit: Math.min(limit, 500) } : {}),
        ...(days > 0 ? { sinceDays: days } : {}),
      });
      res.json(posts);
    }),
  );

  // ── Watchlist config ────────────────────────────────────────────────────
  router.get(
    "/config",
    wrap(async (_req, res) => {
      res.json({ ...(await store.getConfig()), storage: store.kind });
    }),
  );

  router.put(
    "/config/entities/:id",
    requireWrite,
    wrap(async (req, res) => {
      const parsed = entitySchema.safeParse({ ...req.body, id: String(req.params["id"] ?? "") });
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid entity", issues: parsed.error.issues });
        return;
      }
      await store.upsertEntity(parsed.data);
      res.json(parsed.data);
    }),
  );

  router.delete(
    "/config/entities/:id",
    requireWrite,
    wrap(async (req, res) => {
      const id = String(req.params["id"] ?? "");
      if (!ENTITY_ID_PATTERN.test(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      res.status((await store.deleteEntity(id)) ? 204 : 404).end();
    }),
  );

  router.put(
    "/config/settings",
    requireWrite,
    wrap(async (req, res) => {
      const parsed = settingsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid settings", issues: parsed.error.issues });
        return;
      }
      await store.saveSettings(parsed.data);
      res.json(parsed.data);
    }),
  );

  router.get("/config/presets", (_req, res) => {
    res.json(PRESETS.map(({ id, name, description, entities }) => ({ id, name, description, entities })));
  });

  router.post(
    "/config/presets/:id/apply",
    requireWrite,
    wrap(async (req, res) => {
      const preset = findPreset(String(req.params["id"] ?? ""));
      if (!preset) {
        res.status(404).json({ error: "Unknown preset" });
        return;
      }
      const { entities: current } = await store.getConfig();
      const existing = new Set(current.map((entity) => entity.id));
      // Upsert only: never deletes or overwrites companies you already edited.
      const added = preset.entities.filter((entity) => !existing.has(entity.id));
      for (const entity of added) {
        await store.upsertEntity(entity);
      }
      res.json({ added: added.map((entity) => entity.id), skipped: preset.entities.length - added.length });
    }),
  );

  // Dry run: show the derived query and a few live hits without saving anything.
  router.post(
    "/config/preview",
    requireWrite,
    wrap(async (req, res) => {
      const parsed = entitySchema.safeParse({ id: "preview", ...req.body });
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid entity", issues: parsed.error.issues });
        return;
      }
      const query = buildRedditQuery(parsed.data);
      const result = parsed.data.sources.reddit.enabled
        ? await searchReddit(query, { limit: 8, painKeywords: parsed.data.painKeywords })
        : { posts: [], status: "ok" as const };
      res.json({ query, status: result.status, samples: result.posts.slice(0, 8) });
    }),
  );

  // ── Scans ───────────────────────────────────────────────────────────────
  const scanBody = z.object({ entityIds: z.array(z.string().regex(ENTITY_ID_PATTERN)).max(50).optional() });

  router.post(
    "/scan",
    requireWrite,
    wrap(async (req, res) => {
      const parsed = scanBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid scan request", issues: parsed.error.issues });
        return;
      }
      const run = await runScan(store, "manual", parsed.data.entityIds ? { entityIds: parsed.data.entityIds } : {});
      res.json(run);
    }),
  );

  router.get(
    "/scan/runs",
    wrap(async (_req, res) => {
      res.json({ running: isScanRunning(), runs: await store.listScanRuns(10) });
    }),
  );

  // ── Signals (class, importance, confidence) ─────────────────────────────
  let scoring = false;

  router.get(
    "/signals/caps",
    wrap(async (_req, res) => {
      res.json({ caps: capsFromEnv(), jevKeySet: Boolean(process.env["TYPESAFE_API_KEY"]), scoring });
    }),
  );

  router.post(
    "/signals/score",
    requireWrite,
    wrap(async (_req, res) => {
      if (scoring) {
        res.status(409).json({ error: "A scoring run is already in progress" });
        return;
      }
      scoring = true;
      try {
        res.json(await scorePosts(store));
      } finally {
        scoring = false;
      }
    }),
  );

  router.get(
    "/signals/review",
    wrap(async (_req, res) => {
      const { settings } = await store.getConfig();
      res.json({
        threshold: settings.pipeline.reviewConfidence,
        posts: await store.listReview(settings.pipeline.reviewConfidence, 50),
      });
    }),
  );

  router.post(
    "/signals/:postId/feedback",
    requireWrite,
    wrap(async (req, res) => {
      const parsed = z.object({ verdict: z.enum(["right", "wrong"]) }).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "verdict must be right or wrong" });
        return;
      }
      const ok = await store.setFeedback(String(req.params["postId"] ?? ""), parsed.data.verdict);
      res.status(ok ? 204 : 404).end();
    }),
  );

  return router;
}
