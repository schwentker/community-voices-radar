import type {
  CommunityPlatform,
  CommunityPost,
  CommunityPostType,
  CommunityRegion,
} from "../data/community-posts.js";
import type { Entity, RadarConfig, Settings } from "../config/schema.js";
import type { StoredSignal } from "../signals/types.js";

// One storage port, two adapters (Postgres for Neon, memory + JSON file for
// local runs without a database). Routes, tools and the scan runner only see
// this interface (Ports and Adapters / hexagonal architecture).

export interface StoredPost extends CommunityPost {
  entities: string[];
  signal?: StoredSignal;
}

export interface PostQuery {
  entity?: string;
  platform?: CommunityPlatform | "all";
  region?: CommunityRegion | "all";
  type?: CommunityPostType | "all";
  sinceDays?: number;
  limit?: number;
}

export type ScanTrigger = "manual" | "weekly" | "mcp";

export interface EntityScanStats {
  query: string;
  fetched: number;
  stored: number;
  errors: string[];
}

export interface ScanRun {
  id: string;
  trigger: ScanTrigger;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "ok" | "partial" | "error";
  stats: Record<string, EntityScanStats>;
}

export interface Store {
  readonly kind: "postgres" | "memory";
  init(): Promise<void>;
  getConfig(): Promise<RadarConfig>;
  upsertEntity(entity: Entity): Promise<void>;
  deleteEntity(id: string): Promise<boolean>;
  saveSettings(settings: Settings): Promise<void>;
  /** Persists a post and tags it with entities. Returns the id it was stored under (dedupe can merge). */
  savePost(post: CommunityPost, entityIds: string[]): Promise<string>;
  listPosts(query?: PostQuery): Promise<StoredPost[]>;
  saveSignal(postId: string, signal: StoredSignal): Promise<void>;
  /** Posts with no signal yet, newest first. */
  listUnscored(limit: number): Promise<StoredPost[]>;
  /** Scored posts under the confidence bar that nobody has rated yet. */
  listReview(maxConfidence: number, limit: number): Promise<StoredPost[]>;
  setFeedback(postId: string, feedback: "right" | "wrong"): Promise<boolean>;
  saveScanRun(run: ScanRun): Promise<void>;
  listScanRuns(limit?: number, trigger?: ScanTrigger): Promise<ScanRun[]>;
  close(): Promise<void>;
}
