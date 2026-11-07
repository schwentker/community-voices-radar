import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { COMMUNITY_PLATFORMS, COMMUNITY_REGIONS, COMMUNITY_TYPES } from "../data/community-posts.js";
import { buildRedditQuery } from "../config/query.js";
import { getCommunityPosts } from "../sources/community-posts.js";
import { runScan } from "../scan.js";
import type { Store } from "../store/types.js";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

export function registerCommunityTools(server: McpServer, store: Store): void {
  server.tool(
    "get_community_posts",
    "Fetch recent posts from developer community channels (Reddit, Slack, Discourse, Discord) for the companies on the watchlist. Each post lists the watchlist entities it mentions. Types: question, feature_request, integration_pain (pain point), discussion, announcement.",
    {
      entity: z.string().optional().describe("Watchlist entity id, e.g. \"shopify\". See list_watchlist. Omit for all."),
      platform: z.enum(COMMUNITY_PLATFORMS).optional().default("all").describe("Platform filter or \"all\""),
      region: z.enum(COMMUNITY_REGIONS).optional().default("all").describe("Region filter or \"all\""),
      type: z.enum(COMMUNITY_TYPES).optional().default("all").describe("Post type filter or \"all\""),
      days: z.number().int().min(1).max(90).optional().describe("Only posts from the last N days"),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum number of posts to return"),
    },
    async ({ entity, platform = "all", region = "all", type = "all", days, limit }) =>
      json(
        await getCommunityPosts(store, {
          platform,
          region,
          type,
          ...(entity ? { entity } : {}),
          ...(days !== undefined ? { sinceDays: days } : {}),
          ...(limit !== undefined ? { limit } : {}),
        }),
      ),
  );

  server.tool(
    "list_watchlist",
    "List the companies being monitored (primary and competitors), their aliases, sources, and the Reddit query each one uses.",
    {},
    async () => {
      const { settings, entities } = await store.getConfig();
      return json({
        workspace: settings.workspaceName,
        entities: entities.map((entity) => ({
          id: entity.id,
          name: entity.name,
          role: entity.role,
          enabled: entity.enabled,
          aliases: entity.aliases,
          redditQuery: buildRedditQuery(entity),
          forums: entity.sources.discourse.forums,
        })),
      });
    },
  );

  server.tool(
    "compare_entities",
    "Share of voice: post counts per watchlist company over the last N days, broken down by type, with the top posts for each.",
    {
      days: z.number().int().min(1).max(90).optional().default(7).describe("Window in days (default 7)"),
    },
    async ({ days = 7 }) => {
      const { entities } = await store.getConfig();
      const posts = await store.listPosts({ sinceDays: days, limit: 2000 });
      const total = posts.length || 1;
      return json(
        entities.map((entity) => {
          const mine = posts.filter((post) => post.entities.includes(entity.id));
          const byType: Record<string, number> = {};
          for (const post of mine) byType[post.type] = (byType[post.type] ?? 0) + 1;
          return {
            id: entity.id,
            name: entity.name,
            role: entity.role,
            posts: mine.length,
            shareOfVoice: Number((mine.length / total).toFixed(3)),
            byType,
            top: mine.slice(0, 3).map((post) => ({ content: post.content, type: post.type, url: post.meta?.["url"] })),
          };
        }),
      );
    },
  );

  server.tool(
    "run_scan",
    "Fetch fresh posts now for every enabled watchlist company (or the given ids). Takes about 5 seconds per company.",
    {
      entityIds: z.array(z.string()).optional().describe("Limit the scan to these entity ids"),
    },
    async ({ entityIds }) => json(await runScan(store, "mcp", entityIds ? { entityIds } : {})),
  );
}
