import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { Config, OAIModelList } from "./types.ts";
import { handleChatCompletions } from "./completions.ts";
import { logger } from "./logger.ts";

const MODELS: OAIModelList = {
  object: "list",
  data: [
    { id: "claude-sonnet-4-5-20250929", object: "model", created: 1700000000, owned_by: "anthropic" },
    { id: "claude-opus-4-6", object: "model", created: 1700000000, owned_by: "anthropic" },
    { id: "claude-haiku-4-5-20251001", object: "model", created: 1700000000, owned_by: "anthropic" },
  ],
};

function setCorsHeaders(res: ServerResponse, config: Config): void {
  res.setHeader("Access-Control-Allow-Origin", config.corsOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function handleModels(res: ServerResponse, config: Config): void {
  setCorsHeaders(res, config);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(MODELS));
}

function handleHealth(res: ServerResponse, config: Config): void {
  setCorsHeaders(res, config);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok" }));
}

function handleOptions(res: ServerResponse, config: Config): void {
  setCorsHeaders(res, config);
  res.writeHead(204);
  res.end();
}

function handleNotFound(res: ServerResponse, config: Config): void {
  setCorsHeaders(res, config);
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message: "Not found", type: "invalid_request_error" } }));
}

function handleUnauthorized(res: ServerResponse, config: Config): void {
  setCorsHeaders(res, config);
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { message: "Invalid API key", type: "authentication_error" } }));
}

function checkAuth(req: IncomingMessage, config: Config): boolean {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  return token === config.apiKey;
}

export function createProxyServer(config: Config) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || "/";
    const method = req.method || "GET";
    const requestId = (req.headers["x-request-id"] as string) || `req-${randomUUID()}`;
    const startTime = Date.now();

    // Attach request ID to response headers for tracing
    res.setHeader("X-Request-Id", requestId);

    logger.info(`[${method}] ${url} (${requestId})`);

    if (method === "OPTIONS") {
      handleOptions(res, config);
      return;
    }

    if (url === "/health" || url === "/health/") {
      handleHealth(res, config);
      return;
    }

    // All /v1/* endpoints require auth
    if (url.startsWith("/v1/") && !checkAuth(req, config)) {
      handleUnauthorized(res, config);
      return;
    }

    if (url === "/v1/models" || url === "/v1/models/") {
      handleModels(res, config);
      return;
    }

    if ((url === "/v1/chat/completions" || url === "/v1/chat/completions/") && method === "POST") {
      try {
        await handleChatCompletions(req, res, config, requestId);
      } catch (err) {
        logger.error(`[server] Unhandled error (${requestId}):`, err);
        if (!res.headersSent) {
          setCorsHeaders(res, config);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "Internal server error", type: "server_error" } }));
        }
      }
      const elapsed = Date.now() - startTime;
      logger.info(`[${method}] ${url} completed in ${elapsed}ms (${requestId})`);
      return;
    }

    handleNotFound(res, config);
  });

  return server;
}
