import { createHash } from "node:crypto";

import postgres, { type Sql } from "postgres";
import { type CommunityPost } from "../data/community-posts.js";

let dbClient: Sql | undefined;

function getDatabaseUrl(): string {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("Missing required env var: DATABASE_URL");
  }
  return databaseUrl;
}

export function getNeonClient(): Sql {
  if (!dbClient) {
    dbClient = postgres(getDatabaseUrl(), { ssl: "require" });
  }
  return dbClient;
}

export async function closeNeonClient(): Promise<void> {
  if (!dbClient) return;
  await dbClient.end();
  dbClient = undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

export function generateFingerprint(content: string): string {
  const normalized = content
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  return createHash("sha1").update(normalized).digest("hex");
}

export async function persistPost(post: CommunityPost): Promise<void> {
  const db = getNeonClient();
  const fingerprint = generateFingerprint(post.content);
  const ingestedAt = new Date().toISOString();
  const source = post.source ?? `${post.platform}_live`;
  const postMeta = asRecord(post.meta);
  const duplicateRows = await db<{ id: string; meta: unknown }[]>`
    SELECT id, meta
    FROM posts
    WHERE fingerprint = ${fingerprint}
      AND timestamp > NOW() - INTERVAL '1 day'
    ORDER BY timestamp DESC
    LIMIT 1
  `;
  const duplicatePost = duplicateRows[0];

  if (duplicatePost && duplicatePost.id !== post.id) {
    const existingMeta = asRecord(duplicatePost.meta);
    const existingOccurrences =
      typeof existingMeta["occurrences"] === "number" ? Number(existingMeta["occurrences"]) : 1;

    const mergedMeta = {
      ...existingMeta,
      ...postMeta,
      fingerprint,
      ingested_at: ingestedAt,
      occurrences: existingOccurrences + 1,
    };

    await db`
      UPDATE posts
      SET meta = ${JSON.stringify(mergedMeta)}::jsonb,
          updated_at = NOW()
      WHERE id = ${duplicatePost.id}
    `;

    return;
  }

  const enrichedMeta = {
    ...postMeta,
    fingerprint,
    ingested_at: ingestedAt,
    occurrences: typeof postMeta["occurrences"] === "number" ? Number(postMeta["occurrences"]) : 1,
  };

  await db`
    INSERT INTO posts (
      id,
      platform,
      external_id,
      author,
      region,
      content,
      type,
      timestamp,
      source,
      meta,
      fingerprint
    ) VALUES (
      ${post.id},
      ${post.platform},
      ${post.external_id},
      ${post.author},
      ${post.region},
      ${post.content},
      ${post.type},
      ${post.timestamp},
      ${source},
      ${JSON.stringify(enrichedMeta)}::jsonb,
      ${fingerprint}
    )
    ON CONFLICT (id) DO UPDATE SET
      platform = EXCLUDED.platform,
      external_id = EXCLUDED.external_id,
      author = EXCLUDED.author,
      region = EXCLUDED.region,
      content = EXCLUDED.content,
      type = EXCLUDED.type,
      timestamp = EXCLUDED.timestamp,
      source = EXCLUDED.source,
      meta = EXCLUDED.meta,
      fingerprint = EXCLUDED.fingerprint,
      updated_at = NOW()
  `;
}
