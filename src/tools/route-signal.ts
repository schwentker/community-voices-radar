import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type Sql } from "postgres";

const THEMES = ["integration", "automation", "agent", "error", "pricing"];

function detectThemes(posts: { content: string }[]): string[] {
  const counts: Record<string, number> = {};
  for (const theme of THEMES) counts[theme] = 0;

  for (const post of posts) {
    const lower = post.content.toLowerCase();
    for (const theme of THEMES) {
      counts[theme] = (counts[theme] ?? 0) + (lower.includes(theme) ? 1 : 0);
    }
  }

  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([theme]) => theme);
}

const routeSignalSchema = {
  type: z
    .enum(["feature_request", "integration_pain"])
    .optional()
    .describe("Filter by post type. Omit to analyze all types."),
  limit: z.number().optional().describe("Max posts to return (default 5)"),
  minRank: z
    .number()
    .optional()
    .describe("Minimum rank score to include (default 0)"),
};

interface PostRow {
  id: string;
  platform: string;
  author: string;
  region: string;
  content: string;
  type: string;
  timestamp: string;
  source: string;
  upvotes: number | null;
}

export function registerRouteSignalTool(mcp: McpServer, db: Sql) {
  mcp.tool(
    "route_signal",
    "Analyze community posts, rank by engagement, detect themes, and recommend routing action (product backlog vs engineering escalation).",
    routeSignalSchema,
    async (args) => {
      const { type = null, limit = 5, minRank = 0 } = args;

      const rows = type
        ? await db<PostRow[]>`
            SELECT id, platform, author, region, content, type, timestamp, source, upvotes
            FROM posts
            WHERE type = ${type}
            ORDER BY timestamp DESC
            LIMIT 100`
        : await db<PostRow[]>`
            SELECT id, platform, author, region, content, type, timestamp, source, upvotes
            FROM posts
            ORDER BY timestamp DESC
            LIMIT 100`;

      const ranked = rows
        .map((row) => ({
          ...row,
          rank: row.upvotes || 0,
        }))
        .filter((row) => row.rank >= minRank)
        .sort((a, b) => b.rank - a.rank)
        .slice(0, limit);

      const themes = detectThemes(ranked);

      const recommended_action =
        type === "feature_request"
          ? "Route to product backlog"
          : type === "integration_pain"
            ? "Escalate to engineering investigation"
            : "Review signals — mixed type query";

      const summary =
        ranked.length === 0
          ? "No qualifying posts found."
          : `${ranked.length} posts analyzed. Top themes: ${
              themes.join(", ") || "none detected"
            }.`;

      const payload = { summary, themes, recommended_action, posts: ranked };

      const webhookUrl = process.env["SIGNAL_WEBHOOK_URL"];
      if (webhookUrl) {
        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            summary,
            themes,
            top_posts: ranked.slice(0, 3),
          }),
        })
          .then(() => console.log("[route_signal] Routed to SIGNAL_WEBHOOK_URL"))
          .catch((err) =>
            console.error("[route_signal] Webhook failed (non-blocking):", err),
          );
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      };
    },
  );
}
