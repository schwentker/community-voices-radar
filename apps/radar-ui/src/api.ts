// Thin typed client for the radar API. Types mirror src/config/schema.ts on
// the server (the server validates; the UI only shapes requests).

export interface Entity {
  id: string;
  name: string;
  role: "primary" | "competitor";
  aliases: string[];
  exclude: string[];
  sources: {
    reddit: { enabled: boolean; subreddits: string[]; query?: string };
    discourse: { forums: string[] };
  };
  painKeywords: string[];
  color: string;
  enabled: boolean;
}

export interface Settings {
  workspaceName: string;
  themes: string[];
  includeSynthetic: boolean;
  weeklyScan: { enabled: boolean; dayOfWeek: number; hour: number; timeZone: string };
}

export interface RadarConfig {
  settings: Settings;
  entities: Entity[];
  storage: "postgres" | "memory";
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  entities: Entity[];
}

export interface ScanRun {
  id: string;
  trigger: "manual" | "weekly" | "mcp";
  startedAt: string;
  finishedAt?: string;
  status: "running" | "ok" | "partial" | "error";
  stats: Record<string, { query: string; fetched: number; stored: number; errors: string[] }>;
}

export interface PreviewResult {
  query: string;
  status: "ok" | "rate_limited" | "error";
  samples: { id: string; content: string; type: string; timestamp: string; meta?: { url?: string; subreddit?: string } }[];
}

export const API_BASE: string =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.DEV ? "http://localhost:3000" : "https://community-voices-radar.fly.dev");

const TOKEN_KEY = "cvr.apiToken";

export function getToken(): string {
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(token: string): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage blocked: token lasts for this page only
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string; issues?: { path: (string | number)[]; message: string }[] };
      const issue = body.issues?.[0];
      message = issue ? `${issue.path.join(".")}: ${issue.message}` : body.error ?? message;
    } catch {
      // non-JSON error body
    }
    throw new Error(message);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const api = {
  posts: () => request<unknown[]>("/community-posts?limit=500"),
  config: () => request<RadarConfig>("/config"),
  presets: () => request<Preset[]>("/config/presets"),
  applyPreset: (id: string) =>
    request<{ added: string[]; skipped: number }>(`/config/presets/${encodeURIComponent(id)}/apply`, { method: "POST", body: "{}" }),
  saveEntity: (entity: Entity) =>
    request<Entity>(`/config/entities/${encodeURIComponent(entity.id)}`, { method: "PUT", body: JSON.stringify(entity) }),
  deleteEntity: (id: string) => request<void>(`/config/entities/${encodeURIComponent(id)}`, { method: "DELETE" }),
  saveSettings: (settings: Settings) => request<Settings>("/config/settings", { method: "PUT", body: JSON.stringify(settings) }),
  preview: (entity: Entity) => request<PreviewResult>("/config/preview", { method: "POST", body: JSON.stringify(entity) }),
  scan: (entityIds?: string[]) =>
    request<ScanRun>("/scan", { method: "POST", body: JSON.stringify(entityIds ? { entityIds } : {}) }),
  scanRuns: () => request<{ running: boolean; runs: ScanRun[] }>("/scan/runs"),
};

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
