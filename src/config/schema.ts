import { z } from "zod";

// Watchlist config is runtime data, not deploy-time env. Every read from
// storage goes back through these schemas, so a bad row can never reach the
// source adapters.

const term = z.string().trim().min(1).max(80);
const termList = (max: number) => z.array(term).max(max).default([]);

export const ENTITY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SUBREDDIT_PATTERN = /^[A-Za-z0-9_]{2,21}$/;

const httpsUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => new URL(value).protocol === "https:", "Forum URL must use https")
  .transform((value) => value.replace(/\/+$/, ""));

export const redditSourceSchema = z.object({
  enabled: z.boolean().default(true),
  // Empty means search all of Reddit.
  subreddits: z.array(z.string().trim().regex(SUBREDDIT_PATTERN)).max(20).default([]),
  // Escape hatch: a hand-written Reddit query replaces the derived one.
  query: z.string().trim().max(512).optional(),
});

export const discourseSourceSchema = z.object({
  forums: z.array(httpsUrl).max(10).default([]),
});

export const entitySchema = z.object({
  id: z.string().regex(ENTITY_ID_PATTERN, "id must be lowercase letters, digits, dashes"),
  name: term,
  role: z.enum(["primary", "competitor"]).default("primary"),
  aliases: termList(20),
  exclude: termList(20),
  sources: z
    .object({
      reddit: redditSourceSchema.default({}),
      discourse: discourseSourceSchema.default({}),
    })
    .default({}),
  // Words that mark a post as a pain point for this company.
  painKeywords: termList(30),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#6b4fbb"),
  enabled: z.boolean().default(true),
});

export const DEFAULT_THEMES = [
  "pricing",
  "api",
  "checkout",
  "migration",
  "performance",
  "support",
  "integration",
  "agent",
];

export const settingsSchema = z.object({
  workspaceName: z.string().trim().min(1).max(80).default("Community Voices"),
  themes: termList(30).default(DEFAULT_THEMES),
  includeSynthetic: z.boolean().default(false),
  weeklyScan: z
    .object({
      enabled: z.boolean().default(true),
      // 0 = Sunday
      dayOfWeek: z.number().int().min(0).max(6).default(0),
      hour: z.number().int().min(0).max(23).default(9),
      timeZone: z
        .string()
        .default("America/Los_Angeles")
        .refine(isValidTimeZone, "Unknown IANA time zone"),
    })
    .default({}),
});

export type Entity = z.infer<typeof entitySchema>;
export type EntityInput = z.input<typeof entitySchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type SettingsInput = z.input<typeof settingsSchema>;

export interface RadarConfig {
  settings: Settings;
  entities: Entity[];
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
