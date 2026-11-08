import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { CommunityPost } from "../data/community-posts.js";
import {
  entitySchema,
  settingsSchema,
  type Entity,
  type RadarConfig,
  type Settings,
} from "../config/schema.js";
import type { StoredSignal } from "../signals/types.js";
import { entitiesFromEnv } from "./seed.js";
import type { PostQuery, ScanRun, ScanTrigger, Store, StoredPost } from "./types.js";

// Local adapter: watchlist saved to a JSON file, posts and scan runs kept in
// memory. Used when DATABASE_URL is not set, and by the tests.

interface ConfigFile {
  settings: unknown;
  entities: unknown[];
}

export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private settings: Settings = settingsSchema.parse({});
  private entities: Entity[] = [];
  private posts = new Map<string, StoredPost>();
  private runs: ScanRun[] = [];
  private signals = new Map<string, StoredSignal>();

  constructor(private readonly configPath: string | null = null) {}

  async init(): Promise<void> {
    if (!this.configPath) {
      this.entities = entitiesFromEnv();
      return;
    }
    try {
      const raw = JSON.parse(await readFile(this.configPath, "utf8")) as ConfigFile;
      this.settings = settingsSchema.parse(raw.settings ?? {});
      this.entities = (raw.entities ?? []).flatMap((entity) => {
        const parsed = entitySchema.safeParse(entity);
        if (!parsed.success) console.warn("[store] Skipping invalid entity in config file", parsed.error.issues);
        return parsed.success ? [parsed.data] : [];
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.entities = entitiesFromEnv();
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    if (!this.configPath) return;
    await mkdir(dirname(this.configPath), { recursive: true });
    const tmp = `${this.configPath}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ settings: this.settings, entities: this.entities }, null, 2)}\n`);
    await rename(tmp, this.configPath);
  }

  async getConfig(): Promise<RadarConfig> {
    return structuredClone({ settings: this.settings, entities: this.entities });
  }

  async upsertEntity(entity: Entity): Promise<void> {
    const index = this.entities.findIndex((existing) => existing.id === entity.id);
    if (index >= 0) this.entities[index] = entity;
    else this.entities.push(entity);
    await this.persist();
  }

  async deleteEntity(id: string): Promise<boolean> {
    const before = this.entities.length;
    this.entities = this.entities.filter((entity) => entity.id !== id);
    for (const post of this.posts.values()) {
      post.entities = post.entities.filter((entityId) => entityId !== id);
    }
    await this.persist();
    return this.entities.length < before;
  }

  async saveSettings(settings: Settings): Promise<void> {
    this.settings = settings;
    await this.persist();
  }

  async savePost(post: CommunityPost, entityIds: string[]): Promise<string> {
    const existing = this.posts.get(post.id);
    const entities = [...new Set([...(existing?.entities ?? []), ...entityIds])];
    this.posts.set(post.id, { ...post, entities });
    return post.id;
  }

  async listPosts(query: PostQuery = {}): Promise<StoredPost[]> {
    const since = query.sinceDays ? Date.now() - query.sinceDays * 86_400_000 : 0;
    const rows = [...this.posts.values()]
      .filter((post) => !query.entity || post.entities.includes(query.entity))
      .filter((post) => !query.platform || query.platform === "all" || post.platform === query.platform)
      .filter((post) => !query.region || query.region === "all" || post.region === query.region)
      .filter((post) => !query.type || query.type === "all" || post.type === query.type)
      .filter((post) => Date.parse(post.timestamp) >= since)
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    return structuredClone(rows.slice(0, query.limit ?? 200).map((post) => this.withSignal(post)));
  }

  private withSignal(post: StoredPost): StoredPost {
    const signal = this.signals.get(post.id);
    return signal ? { ...post, signal } : post;
  }

  async saveSignal(postId: string, signal: StoredSignal): Promise<void> {
    const existing = this.signals.get(postId);
    this.signals.set(postId, existing?.feedback ? { ...signal, feedback: existing.feedback } : signal);
  }

  async listUnscored(limit: number): Promise<StoredPost[]> {
    const rows = [...this.posts.values()]
      .filter((post) => !this.signals.has(post.id))
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    return structuredClone(rows.slice(0, limit));
  }

  async listReview(maxConfidence: number, limit: number): Promise<StoredPost[]> {
    const rows = [...this.posts.values()]
      .filter((post) => {
        const signal = this.signals.get(post.id);
        return signal !== undefined && signal.confidence < maxConfidence && !signal.feedback;
      })
      .sort((a, b) => (this.signals.get(b.id)?.importance ?? 0) - (this.signals.get(a.id)?.importance ?? 0));
    return structuredClone(rows.slice(0, limit).map((post) => this.withSignal(post)));
  }

  async setFeedback(postId: string, feedback: "right" | "wrong"): Promise<boolean> {
    const signal = this.signals.get(postId);
    if (!signal) return false;
    this.signals.set(postId, { ...signal, feedback });
    return true;
  }

  async saveScanRun(run: ScanRun): Promise<void> {
    const index = this.runs.findIndex((existing) => existing.id === run.id);
    if (index >= 0) this.runs[index] = structuredClone(run);
    else this.runs.unshift(structuredClone(run));
  }

  async listScanRuns(limit = 10, trigger?: ScanTrigger): Promise<ScanRun[]> {
    return structuredClone(this.runs.filter((run) => !trigger || run.trigger === trigger).slice(0, limit));
  }

  async close(): Promise<void> {}
}
