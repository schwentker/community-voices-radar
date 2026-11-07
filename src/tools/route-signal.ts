import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Store, StoredPost } from "../store/types.js";

export function detectThemes(posts: { content: string }[], themes: string[], top = 2): string[] {
  const counts = new Map<string, number>(themes.map((theme) => [theme, 0]));
  for (const post of posts) {
    const lower = post.content.toLowerCase();
    for (const theme of themes) {
      if (lower.includes(theme.toLowerCase())) counts.set(theme, (counts.get(theme) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([theme]) => theme);
}

function rankOf(post: StoredPost): number {
  const rank = post.meta?.["rank"];
  return typeof rank === "number" ? rank : 0;
}

const routeSignalSchema = {
  type: z
    .enum(["feature_request", "integration_pain"])
    .optional()
    .describe("Filter by post type. Omit to analyze all types."),
  entity: z.string().optional().describe("Watchlist entity id to analyze. Omit for all."),
  limit: z.number().optional().describe("Max posts to return (default 5)"),
  minRank: z.number().optional().describe("Minimum rank score to include (default 0)"),
};

export function registerRouteSignalTool(mcp: McpServer, store: Store) {
  mcp.tool(
    "route_signal",
    "Analyze community posts, rank by engagement, detect themes (from the watchlist settings), and recommend routing action (product backlog vs engineering escalation).",
    routeSignalSchema,
    async (args) => {
      const { type, entity, limit = 5, minRank = 0 } = args;
      const { settings } = await store.getConfig();
      const rows = await store.listPosts({
        limit: 100,
        ...(type ? { type } : {}),
        ...(entity ? { entity } : {}),
      });

      const ranked = rows
        .map((row) => ({ ...row, rank: rankOf(row) }))
        .filter((row) => row.rank >= minRank)
        .sort((a, b) => b.rank - a.rank)
        .slice(0, limit);

      const themes = detectThemes(ranked, settings.themes);

      const recommended_action =
        type === "feature_request"
          ? "Route to product backlog"
          : type === "integration_pain"
            ? "Escalate to engineering investigation"
            : "Review signals: mixed type query";

      const summary =
        ranked.length === 0
          ? "No qualifying posts found."
          : `${ranked.length} posts analyzed. Top themes: ${themes.join(", ") || "none detected"}.`;

      const payload = { summary, themes, recommended_action, posts: ranked };

      const webhookUrl = process.env["SIGNAL_WEBHOOK_URL"];
      if (webhookUrl) {
        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, entity, summary, themes, top_posts: ranked.slice(0, 3) }),
        })
          .then(() => console.log("[route_signal] Routed to SIGNAL_WEBHOOK_URL"))
          .catch((err) => console.error("[route_signal] Webhook failed (non-blocking):", err));
      }

      return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
    },
  );
}
