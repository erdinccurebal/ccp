import type { Config } from "./types.ts";
import { createProxyServer } from "./server.ts";
import { startSessionCleanup, initSessionPersistence, shutdownSessions } from "./session.ts";
import { cleanupTempImages, validateClaudeCli } from "./claude-cli.ts";
import { logger } from "./logger.ts";

const config: Config = {
  port: parseInt(process.env.PORT || "8888", 10),
  host: process.env.HOST || "127.0.0.1",
  apiKey: process.env.API_KEY || "CCP_API_KEY",
  claudePath: process.env.CLAUDE_PATH || "claude",
  claudeWorkingDir: process.env.CLAUDE_WORKING_DIR || process.cwd(),
  claudePermissionMode: process.env.CLAUDE_PERMISSION_MODE || "default",
  claudeMaxTurns: parseInt(process.env.CLAUDE_MAX_TURNS || "25", 10),
  claudeTimeoutMs: parseInt(process.env.CLAUDE_TIMEOUT_MS || "300000", 10),
  sessionTtlMs: parseInt(process.env.SESSION_TTL_MS || "3600000", 10),
  defaultModel: process.env.DEFAULT_MODEL || "claude-sonnet-4-5-20250929",
  corsOrigin: process.env.CORS_ORIGIN || "*",
};

if (config.claudePermissionMode === "bypassPermissions") {
  logger.warn("Permission mode is set to 'bypassPermissions'. Claude CLI safety checks are DISABLED.");
  logger.warn("Set CLAUDE_PERMISSION_MODE to a safer mode in production environments.");
}

// Validate Claude CLI is available before starting the server
try {
  validateClaudeCli(config.claudePath);
} catch (err) {
  logger.error(`[startup] ${(err as Error).message}`);
  process.exit(1);
}

const server = createProxyServer(config);

// Session persistence: restore from disk and auto-flush
const sessionFile = process.env.SESSION_FILE || "";
if (sessionFile) {
  initSessionPersistence(sessionFile);
}

startSessionCleanup(config.sessionTtlMs);

// Graceful shutdown
function shutdown(signal: string) {
  logger.info(`${signal} received. Shutting down gracefully...`);
  shutdownSessions();
  cleanupTempImages();
  server.close(() => {
    logger.info("Server closed.");
    process.exit(0);
  });
  // Force exit after 10s
  setTimeout(() => {
    logger.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

server.listen(config.port, config.host, () => {
  logger.info(`claude-code-proxy listening on http://${config.host}:${config.port}`);
  logger.info(`  Claude path:       ${config.claudePath}`);
  logger.info(`  Working dir:       ${config.claudeWorkingDir}`);
  logger.info(`  Permission mode:   ${config.claudePermissionMode}`);
  logger.info(`  Max turns:         ${config.claudeMaxTurns}`);
  logger.info(`  Timeout:           ${config.claudeTimeoutMs}ms`);
  logger.info(`  Default model:     ${config.defaultModel}`);
  logger.info(`  API key:           ${config.apiKey.slice(0, 4)}${"*".repeat(Math.max(0, config.apiKey.length - 4))}`);
  logger.info(`  Session TTL:       ${config.sessionTtlMs}ms`);
  logger.info(`  Session file:      ${sessionFile || "disabled (in-memory only)"}`);
  logger.info(`  CORS origin:       ${config.corsOrigin}`);
  logger.info(`  Log level:         ${logger.getLevel()}`);
  logger.info(`  Log file:          ${logger.getFilePath() || "disabled"}`);
  if (logger.getFilePath()) {
    logger.info(`  Log max size:      ${(logger.getMaxSize() / 1024 / 1024).toFixed(1)}MB`);
    logger.info(`  Log max files:     ${logger.getMaxFiles()}`);
  }
});
