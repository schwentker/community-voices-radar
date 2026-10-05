import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { COMMUNITY_PLATFORMS, COMMUNITY_REGIONS, COMMUNITY_TYPES } from "../data/community-posts.js";
import { getCommunityPosts } from "../sources/community-posts.js";

export function registerCommunityTools(server: McpServer): void {
  server.tool(
    "get_community_posts",
    "Fetch recent posts from developer community channels (Reddit, Slack, Discourse, Discord). Returns posts with author, region, platform, content, and type (question/feature_request/integration_pain/discussion/announcement).",
    {
      platform: z
        .enum(COMMUNITY_PLATFORMS)
        .optional()
        .default("all")
        .describe('Filter by platform: "reddit", "slack", "discourse", "discord", or "all"'),
      region: z
        .enum(COMMUNITY_REGIONS)
        .optional()
        .default("all")
        .describe('Filter by region: "india", "europe", "us", "japan", "brazil", "unknown", or "all"'),
      type: z
        .enum(COMMUNITY_TYPES)
        .optional()
        .default("all")
        .describe(
          'Filter by type: "question", "feature_request", "integration_pain", "discussion", "announcement", or "all"'
        ),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum number of posts to return"),
    },
    async ({ platform = "all", region = "all", type = "all", limit }) => {
      const filteredPosts = await getCommunityPosts({
        platform,
        region,
        type,
        ...(limit !== undefined ? { limit } : {}),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(filteredPosts, null, 2) }],
      };
    }
  );
}
