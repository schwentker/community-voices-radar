import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

import { closeNeonClient, getNeonClient } from "./db/neon.js";
import {
  COMMUNITY_PLATFORMS,
  COMMUNITY_REGIONS,
  COMMUNITY_TYPES,
} from "./data/community-posts.js";
import { getCommunityPosts } from "./sources/community-posts.js";
import { registerCommunityTools } from "./tools/community-posts.js";
import { registerRouteSignalTool } from "./tools/route-signal.js";

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
const HOST = process.env["HOST"] ?? "0.0.0.0";
const COMM_VOICES_API_TOKEN = process.env["COMM_VOICES_API_TOKEN"];
const db = getNeonClient();

const mcp = new McpServer({
  name: "community-voices-radar",
  version: "1.0.0",
});

registerCommunityTools(mcp);
registerRouteSignalTool(mcp, db);

const app = express();
app.use(express.json());
app.locals["commVoicesApiToken"] = COMM_VOICES_API_TOKEN;

function requireBearerAuth(req: Request, res: Response): boolean {
  if (!COMM_VOICES_API_TOKEN) {
    return true;
  }

  const authorization = req.header("authorization");
  const expectedAuthorization = `Bearer ${COMM_VOICES_API_TOKEN}`;

  if (authorization === expectedAuthorization) {
    return true;
  }

  res.status(401).json({ error: "Unauthorized" });
  return false;
}

function getAllowedQueryValue<T extends readonly string[]>(
  value: unknown,
  allowedValues: T,
): T[number] {
  return typeof value === "string" && allowedValues.includes(value)
    ? (value as T[number])
    : ("all" as T[number]);
}

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/community-posts", async (req: Request, res: Response) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const platform = getAllowedQueryValue(
    req.query["platform"],
    COMMUNITY_PLATFORMS,
  );
  const region = getAllowedQueryValue(req.query["region"], COMMUNITY_REGIONS);
  const type = getAllowedQueryValue(req.query["type"], COMMUNITY_TYPES);
  const limitParam =
    typeof req.query["limit"] === "string"
      ? Number.parseInt(req.query["limit"], 10)
      : undefined;

  const posts = await getCommunityPosts({
    platform,
    region,
    type,
    ...(limitParam && limitParam > 0 ? { limit: limitParam } : {}),
  });

  res.type("application/json").status(200).json(posts);
});

const transports = new Map<string, SSEServerTransport>();

app.get("/sse", async (_req: Request, res: Response) => {
  /* if (!requireBearerAuth(_req, res)) {
    return;
    } */
  // TEMP: allow unauthenticated SSE for MCP tools (Inspector / Claude)
  if (_req.headers.authorization !== `Bearer ${COMM_VOICES_API_TOKEN}`) {
    console.log("SSE: allowing unauthenticated connection (demo mode)");
  }

  const transport = new SSEServerTransport("/messages", res);
  const sessionId = transport.sessionId;

  console.log("STORE SESSION", sessionId);
  transports.set(sessionId, transport);
  console.log("MAP AFTER STORE", Array.from(transports.keys()));

  transport.onclose = () => {
    console.log("SESSION CLOSED (retained)", sessionId);
    // transports.delete(sessionId);
  };

  transport.onerror = (error) => {
    console.error(`[mcp] SSE transport error for session ${sessionId}`, error);
  };

  await mcp.connect(transport);
});

app.post("/messages", async (req: Request, res: Response) => {
  const sessionId = req.query["sessionId"] as string | undefined;

  if (!sessionId) {
    res.status(400).json({ error: "Missing sessionId query parameter" });
    return;
  }

  console.log("LOOKUP SESSION", sessionId);
  console.log("MAP BEFORE LOOKUP", Array.from(transports.keys()));
  const transport = transports.get(sessionId);

  if (!transport) {
    res
      .status(400)
      .json({ error: `No active session for sessionId: ${sessionId}` });
    return;
  }

  console.log("MESSAGE RECEIVED", sessionId);

  const message = req.body as
    | { method?: string; params?: { name?: string } }
    | undefined;
  const toolName =
    message?.method === "tools/call" ? message.params?.name : undefined;

  if (toolName) {
    console.log(`[mcp] Tool invoked: ${toolName}`);
  }

  if (!message) {
    res.status(400).json({ error: "Missing JSON-RPC message body" });
    return;
  }

  try {
    await transport.handleMessage(message);
    console.log(`[mcp] Response sent for session ${sessionId}`);
    res.status(200).end();
  } catch (error) {
    console.error(
      `[mcp] Failed to handle message for session ${sessionId}`,
      error,
    );
    res.status(400).json({ error: "Invalid MCP message" });
  }
});

const INSIGHT_KEYWORDS = ["integration", "automation", "agent", "error", "pricing"] as const;
const INSIGHT_PREFIXES = [
  "Increasing demand for",
  "Rising issues around",
  "Growing interest in",
] as const;

app.get("/insights/acknowledged", async (_req: Request, res: Response) => {
  const rows = await db<{ content: string }[]>`
    SELECT content FROM posts WHERE timestamp > NOW() - INTERVAL '24 hours'
  `;

  const counts: Record<string, number> = {};
  for (const kw of INSIGHT_KEYWORDS) counts[kw] = 0;

  for (const row of rows) {
    const lower = row.content.toLowerCase();
    for (const kw of INSIGHT_KEYWORDS) {
      if (lower.includes(kw)) counts[kw] = (counts[kw] ?? 0) + 1;
    }
  }

  const top = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const acknowledged = top.map(
    ([theme], i) => `${INSIGHT_PREFIXES[i] ?? "Growing interest in"} ${theme}`,
  );

  res.json({ acknowledged });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  const toolCount = (
    mcp as unknown as { _registeredTools: Record<string, unknown> }
  )._registeredTools
    ? Object.keys(
        (mcp as unknown as { _registeredTools: Record<string, unknown> })
          ._registeredTools,
      ).length
    : "unknown";

  console.log(`[community-voices-radar] Listening on ${HOST}:${PORT}`);
  console.log(`[community-voices-radar] Registered tools: ${toolCount}`);
  console.log(
    `[community-voices-radar] SSE endpoint:  GET  http://localhost:${PORT}/sse`,
  );
  console.log(
    `[community-voices-radar] Message endpoint: POST http://localhost:${PORT}/messages`,
  );
  console.log(
    `[community-voices-radar] Health endpoint:  GET  http://localhost:${PORT}/health`,
  );
  console.log(
    `[community-voices-radar] Community endpoint: GET  http://localhost:${PORT}/community-posts`,
  );
});
process.on("SIGTERM", () => {
  console.log(
    "[community-voices-radar] SIGTERM received - shutting down gracefully",
  );
  server.close(() => {
    console.log("[community-voices-radar] HTTP server closed");
    void closeNeonClient();
    process.exit(0);
  });
});
