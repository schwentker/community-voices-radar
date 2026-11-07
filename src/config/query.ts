import type { Entity } from "./schema.js";

// Pure functions: config in, query or match out. Easy to unit test and the
// same logic drives both the scan and the dry-run preview.

const MAX_QUERY_LENGTH = 512;

export function entityTerms(entity: Entity): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of [entity.name, ...entity.aliases]) {
    const value = raw.trim();
    const key = value.toLowerCase();
    if (value && !seen.has(key)) {
      seen.add(key);
      terms.push(value);
    }
  }
  return terms;
}

function quote(term: string): string {
  const cleaned = term.replace(/"/g, "");
  return /[\s:()]/.test(cleaned) ? `"${cleaned}"` : cleaned;
}

export function buildRedditQuery(entity: Entity): string {
  const override = entity.sources.reddit.query?.trim();
  if (override) {
    return override.slice(0, MAX_QUERY_LENGTH);
  }

  const parts = [`(${entityTerms(entity).map(quote).join(" OR ")})`];

  for (const term of entity.exclude) {
    parts.push(`NOT ${quote(term)}`);
  }

  const subreddits = entity.sources.reddit.subreddits;
  if (subreddits.length > 0) {
    parts.push(`(${subreddits.map((name) => `subreddit:${name}`).join(" OR ")})`);
  }

  return parts.join(" ").slice(0, MAX_QUERY_LENGTH);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termPattern(term: string): RegExp {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(term.toLowerCase())}($|[^\\p{L}\\p{N}])`, "u");
}

export function mentionsEntity(text: string, entity: Entity): boolean {
  const lower = text.toLowerCase();
  if (!entityTerms(entity).some((term) => termPattern(term).test(lower))) {
    return false;
  }
  return !entity.exclude.some((term) => termPattern(term).test(lower));
}

/** Entity ids mentioned in a post, so one post can count for several companies. */
export function matchEntities(text: string, entities: Entity[]): string[] {
  return entities.filter((entity) => mentionsEntity(text, entity)).map((entity) => entity.id);
}
