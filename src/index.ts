import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

import { createApiRouter } from "./http/api.js";
import { startWeeklySchedule } from "./scan.js";
import { createStore } from "./store/index.js";
import { registerCommunityTools } from "./tools/community-posts.js";
import { detectThemes, registerRouteSignalTool } from "./tools/route-signal.js";

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
const HOST = process.env["HOST"] ?? "0.0.0.0";
const COMM_VOICES_API_TOKEN = process.env["COMM_VOICES_API_TOKEN"];
const CORS_ORIGINS = (process.env["CORS_ORIGINS"] ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const store = createStore();
await store.init();

const mcp = new McpServer({
  name: "community-voices-radar",
  version: "1.0.0",
});

registerCommunityTools(mcp, store);
registerRouteSignalTool(mcp, store);

const app = express();
app.use(express.json());
app.locals["commVoicesApiToken"] = COMM_VOICES_API_TOKEN;

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use(createApiRouter(store, { apiToken: COMM_VOICES_API_TOKEN, allowedOrigins: CORS_ORIGINS }));

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

const INSIGHT_PREFIXES = ["Increasing demand for", "Rising issues around", "Growing interest in"] as const;

app.get("/insights/acknowledged", async (_req: Request, res: Response) => {
  const [{ settings }, posts] = await Promise.all([store.getConfig(), store.listPosts({ sinceDays: 1, limit: 1000 })]);
  const acknowledged = detectThemes(posts, settings.themes, 3).map(
    (theme, i) => `${INSIGHT_PREFIXES[i] ?? "Growing interest in"} ${theme}`,
  );
  res.json({ acknowledged });
});

const server = app.listen(PORT, HOST, () => {
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
  console.log(`[community-voices-radar] Watchlist storage: ${store.kind}`);
});

startWeeklySchedule(store);
process.on("SIGTERM", () => {
  console.log(
    "[community-voices-radar] SIGTERM received - shutting down gracefully",
  );
  server.close(() => {
    console.log("[community-voices-radar] HTTP server closed");
    void store.close();
    process.exit(0);
  });
});
