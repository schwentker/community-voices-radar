import type { Sql } from "postgres";

import type { CommunityPost } from "../data/community-posts.js";
import {
  entitySchema,
  settingsSchema,
  type Entity,
  type RadarConfig,
  type Settings,
} from "../config/schema.js";
import { closeNeonClient, getNeonClient, persistPost } from "../db/neon.js";
import type { StoredSignal } from "../signals/types.js";
import { entitiesFromEnv } from "./seed.js";
import type { PostQuery, ScanRun, ScanTrigger, Store, StoredPost } from "./types.js";

// Neon adapter. Entities are stored as validated JSONB documents (one row per
// company) so the schema can grow without ALTER TABLE; every read is
// re-validated with zod. Tables are created idempotently at boot.

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS radar_settings (
     id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
     config JSONB NOT NULL,
     updated_at TIMESTAMPTZ DEFAULT NOW()
   )`,
  `CREATE TABLE IF NOT EXISTS watch_entities (
     id TEXT PRIMARY KEY,
     config JSONB NOT NULL,
     position INT NOT NULL DEFAULT 0,
     updated_at TIMESTAMPTZ DEFAULT NOW()
   )`,
  `CREATE TABLE IF NOT EXISTS post_entities (
     post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
     entity_id TEXT NOT NULL,
     created_at TIMESTAMPTZ DEFAULT NOW(),
     PRIMARY KEY (post_id, entity_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_post_entities_entity ON post_entities(entity_id)`,
  `CREATE TABLE IF NOT EXISTS post_signals (
     post_id TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
     signal_class TEXT NOT NULL,
     importance REAL NOT NULL,
     confidence REAL NOT NULL,
     engine TEXT NOT NULL,
     reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
     feedback TEXT,
     scored_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_post_signals_confidence ON post_signals(confidence)`,
  `CREATE TABLE IF NOT EXISTS scan_runs (
     id TEXT PRIMARY KEY,
     trigger TEXT NOT NULL,
     status TEXT NOT NULL,
     started_at TIMESTAMPTZ NOT NULL,
     finished_at TIMESTAMPTZ,
     stats JSONB NOT NULL DEFAULT '{}'::jsonb
   )`,
  `CREATE INDEX IF NOT EXISTS idx_scan_runs_trigger ON scan_runs(trigger, started_at DESC)`,
];

interface PostRow {
  id: string;
  external_id: string | null;
  platform: CommunityPost["platform"];
  author: string | null;
  region: CommunityPost["region"] | null;
  content: string | null;
  type: CommunityPost["type"] | null;
  timestamp: Date | string;
  source: string | null;
  meta: Record<string, unknown> | null;
  entities: string[] | null;
  signal_class: StoredSignal["signalClass"] | null;
  importance: number | null;
  confidence: number | null;
  engine: string | null;
  reasons: string[] | null;
  feedback: "right" | "wrong" | null;
  scored_at: Date | string | null;
}

interface ScanRow {
  id: string;
  trigger: ScanTrigger;
  status: ScanRun["status"];
  started_at: Date;
  finished_at: Date | null;
  stats: ScanRun["stats"];
}

function toStoredPost(row: PostRow): StoredPost {
  const post: StoredPost = {
    id: row.id,
    external_id: row.external_id ?? row.id,
    platform: row.platform,
    author: row.author ?? "unknown",
    region: row.region ?? "unknown",
    content: row.content ?? "",
    type: row.type ?? "discussion",
    timestamp: new Date(row.timestamp).toISOString(),
    source: row.source ?? `${row.platform}_live`,
    meta: row.meta ?? {},
    entities: row.entities ?? [],
  };
  if (row.signal_class && row.importance !== null && row.confidence !== null && row.engine && row.scored_at) {
    post.signal = {
      signalClass: row.signal_class,
      importance: row.importance,
      confidence: row.confidence,
      reasons: row.reasons ?? [],
      engine: row.engine,
      scoredAt: new Date(row.scored_at).toISOString(),
      ...(row.feedback ? { feedback: row.feedback } : {}),
    };
  }
  return post;
}

export class PostgresStore implements Store {
  readonly kind = "postgres" as const;
  private readonly db: Sql;

  constructor(db?: Sql) {
    this.db = db ?? getNeonClient();
  }

  async init(): Promise<void> {
    for (const statement of MIGRATIONS) {
      await this.db.unsafe(statement);
    }
    const existing = await this.db`SELECT 1 FROM radar_settings WHERE id = 1`;
    if (existing.length === 0) {
      // First boot with the watchlist: seed from the old env vars, once.
      await this.saveSettings(settingsSchema.parse({}));
      for (const entity of entitiesFromEnv()) {
        await this.upsertEntity(entity);
      }
    }
  }

  async getConfig(): Promise<RadarConfig> {
    const [settingsRows, entityRows] = await Promise.all([
      this.db<{ config: unknown }[]>`SELECT config FROM radar_settings WHERE id = 1`,
      this.db<{ config: unknown }[]>`SELECT config FROM watch_entities ORDER BY position, id`,
    ]);
    const entities = entityRows.flatMap((row) => {
      const parsed = entitySchema.safeParse(row.config);
      if (!parsed.success) console.warn("[store] Skipping invalid entity row", parsed.error.issues);
      return parsed.success ? [parsed.data] : [];
    });
    return { settings: settingsSchema.parse(settingsRows[0]?.config ?? {}), entities };
  }

  async upsertEntity(entity: Entity): Promise<void> {
    await this.db`
      INSERT INTO watch_entities (id, config, position)
      VALUES (
        ${entity.id},
        ${this.db.json(entity as never)},
        (SELECT COALESCE(MAX(position) + 1, 0) FROM watch_entities)
      )
      ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()
    `;
  }

  async deleteEntity(id: string): Promise<boolean> {
    const deleted = await this.db`DELETE FROM watch_entities WHERE id = ${id} RETURNING id`;
    await this.db`DELETE FROM post_entities WHERE entity_id = ${id}`;
    return deleted.length > 0;
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.db`
      INSERT INTO radar_settings (id, config) VALUES (1, ${this.db.json(settings as never)})
      ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()
    `;
  }

  async savePost(post: CommunityPost, entityIds: string[]): Promise<string> {
    const storedId = await persistPost(post);
    for (const entityId of new Set(entityIds)) {
      await this.db`
        INSERT INTO post_entities (post_id, entity_id) VALUES (${storedId}, ${entityId})
        ON CONFLICT DO NOTHING
      `;
    }
    return storedId;
  }

  async listPosts(query: PostQuery = {}): Promise<StoredPost[]> {
    const db = this.db;
    const empty = db``;
    const rows = await db<PostRow[]>`
      SELECT p.id, p.external_id, p.platform, p.author, p.region, p.content, p.type,
             p.timestamp, p.source, p.meta,
             COALESCE(array_agg(pe.entity_id) FILTER (WHERE pe.entity_id IS NOT NULL), '{}') AS entities,
             ps.signal_class, ps.importance, ps.confidence, ps.engine, ps.reasons, ps.feedback, ps.scored_at
      FROM posts p
      LEFT JOIN post_entities pe ON pe.post_id = p.id
      LEFT JOIN post_signals ps ON ps.post_id = p.id
      WHERE TRUE
        ${query.entity ? db`AND EXISTS (SELECT 1 FROM post_entities x WHERE x.post_id = p.id AND x.entity_id = ${query.entity})` : empty}
        ${query.platform && query.platform !== "all" ? db`AND p.platform = ${query.platform}` : empty}
        ${query.region && query.region !== "all" ? db`AND p.region = ${query.region}` : empty}
        ${query.type && query.type !== "all" ? db`AND p.type = ${query.type}` : empty}
        ${query.sinceDays ? db`AND p.timestamp > NOW() - make_interval(days => ${query.sinceDays})` : empty}
      GROUP BY p.id, ps.post_id
      ORDER BY p.timestamp DESC
      LIMIT ${query.limit ?? 200}
    `;

    return rows.map(toStoredPost);
  }

  async saveSignal(postId: string, signal: StoredSignal): Promise<void> {
    await this.db`
      INSERT INTO post_signals (post_id, signal_class, importance, confidence, engine, reasons, scored_at)
      VALUES (${postId}, ${signal.signalClass}, ${signal.importance}, ${signal.confidence}, ${signal.engine},
              ${this.db.json(signal.reasons as never)}, ${signal.scoredAt})
      ON CONFLICT (post_id) DO UPDATE SET
        signal_class = EXCLUDED.signal_class, importance = EXCLUDED.importance,
        confidence = EXCLUDED.confidence, engine = EXCLUDED.engine,
        reasons = EXCLUDED.reasons, scored_at = EXCLUDED.scored_at
    `;
  }

  async listUnscored(limit: number): Promise<StoredPost[]> {
    const rows = await this.db<PostRow[]>`
      SELECT p.id, p.external_id, p.platform, p.author, p.region, p.content, p.type, p.timestamp, p.source, p.meta,
             COALESCE(array_agg(pe.entity_id) FILTER (WHERE pe.entity_id IS NOT NULL), '{}') AS entities,
             NULL::text AS signal_class, NULL::real AS importance, NULL::real AS confidence, NULL::text AS engine,
             NULL::jsonb AS reasons, NULL::text AS feedback, NULL::timestamptz AS scored_at
      FROM posts p
      LEFT JOIN post_entities pe ON pe.post_id = p.id
      WHERE NOT EXISTS (SELECT 1 FROM post_signals s WHERE s.post_id = p.id)
      GROUP BY p.id
      ORDER BY p.timestamp DESC
      LIMIT ${limit}
    `;
    return rows.map(toStoredPost);
  }

  async listReview(maxConfidence: number, limit: number): Promise<StoredPost[]> {
    const rows = await this.db<PostRow[]>`
      SELECT p.id, p.external_id, p.platform, p.author, p.region, p.content, p.type, p.timestamp, p.source, p.meta,
             COALESCE(array_agg(pe.entity_id) FILTER (WHERE pe.entity_id IS NOT NULL), '{}') AS entities,
             ps.signal_class, ps.importance, ps.confidence, ps.engine, ps.reasons, ps.feedback, ps.scored_at
      FROM post_signals ps
      JOIN posts p ON p.id = ps.post_id
      LEFT JOIN post_entities pe ON pe.post_id = p.id
      WHERE ps.confidence < ${maxConfidence} AND ps.feedback IS NULL
      GROUP BY p.id, ps.post_id
      ORDER BY ps.importance DESC
      LIMIT ${limit}
    `;
    return rows.map(toStoredPost);
  }

  async setFeedback(postId: string, feedback: "right" | "wrong"): Promise<boolean> {
    const updated = await this.db`UPDATE post_signals SET feedback = ${feedback} WHERE post_id = ${postId} RETURNING post_id`;
    return updated.length > 0;
  }

  async saveScanRun(run: ScanRun): Promise<void> {
    await this.db`
      INSERT INTO scan_runs (id, trigger, status, started_at, finished_at, stats)
      VALUES (${run.id}, ${run.trigger}, ${run.status}, ${run.startedAt}, ${run.finishedAt ?? null}, ${this.db.json(run.stats as never)})
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, finished_at = EXCLUDED.finished_at, stats = EXCLUDED.stats
    `;
  }

  async listScanRuns(limit = 10, trigger?: ScanTrigger): Promise<ScanRun[]> {
    const rows = await this.db<ScanRow[]>`
      SELECT id, trigger, status, started_at, finished_at, stats FROM scan_runs
      ${trigger ? this.db`WHERE trigger = ${trigger}` : this.db``}
      ORDER BY started_at DESC
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      id: row.id,
      trigger: row.trigger,
      status: row.status,
      startedAt: new Date(row.started_at).toISOString(),
      ...(row.finished_at ? { finishedAt: new Date(row.finished_at).toISOString() } : {}),
      stats: row.stats ?? {},
    }));
  }

  async close(): Promise<void> {
    await closeNeonClient();
  }
}
