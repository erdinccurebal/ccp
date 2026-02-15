import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { OAIMessage } from "./types.ts";
import { logger } from "./logger.ts";

interface SessionEntry {
  sessionId: string;
  createdAt: number;
}

const sessions = new Map<string, SessionEntry>();
let persistPath: string | null = null;
let persistTimer: NodeJS.Timeout | null = null;
let dirty = false;

/**
 * Configure file-based session persistence.
 * When set, sessions are periodically saved to disk and restored on startup.
 */
export function initSessionPersistence(filePath: string): void {
  persistPath = filePath;

  // Ensure directory exists
  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch {
    // directory may already exist
  }

  // Restore sessions from disk
  try {
    if (existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, SessionEntry>;
      let count = 0;
      for (const [hash, entry] of Object.entries(data)) {
        sessions.set(hash, entry);
        count++;
      }
      logger.info(`[session] Restored ${count} sessions from ${filePath}`);
    }
  } catch (err) {
    logger.warn(`[session] Failed to restore sessions from ${filePath}:`, err);
  }

  // Flush to disk every 30 seconds if dirty
  persistTimer = setInterval(() => {
    if (dirty) flushSessions();
  }, 30_000);
}

/** Write current sessions to disk. */
export function flushSessions(): void {
  if (!persistPath) return;

  try {
    const obj: Record<string, SessionEntry> = {};
    for (const [hash, entry] of sessions) {
      obj[hash] = entry;
    }
    writeFileSync(persistPath, JSON.stringify(obj), "utf-8");
    dirty = false;
    logger.debug(`[session] Flushed ${sessions.size} sessions to ${persistPath}`);
  } catch (err) {
    logger.error(`[session] Failed to flush sessions:`, err);
  }
}

export function hashMessages(messages: OAIMessage[]): string {
  const payload = JSON.stringify(messages);
  return createHash("sha256").update(payload).digest("hex");
}

export function lookupSession(contextMessages: OAIMessage[]): string | null {
  if (contextMessages.length === 0) return null;
  const hash = hashMessages(contextMessages);
  const entry = sessions.get(hash);
  return entry ? entry.sessionId : null;
}

export function storeSession(contextMessages: OAIMessage[], sessionId: string): void {
  const hash = hashMessages(contextMessages);
  sessions.set(hash, { sessionId, createdAt: Date.now() });
  dirty = true;
}

export function cleanupSessions(ttlMs: number): void {
  const now = Date.now();
  let removed = 0;
  for (const [hash, entry] of sessions) {
    if (now - entry.createdAt > ttlMs) {
      sessions.delete(hash);
      removed++;
    }
  }
  if (removed > 0) {
    dirty = true;
    logger.debug(`[session] Cleaned up ${removed} expired sessions`);
  }
}

export function startSessionCleanup(ttlMs: number): NodeJS.Timeout {
  return setInterval(() => cleanupSessions(ttlMs), ttlMs / 2);
}

export function getSessionCount(): number {
  return sessions.size;
}

/** Stop persistence timer and flush final state. */
export function shutdownSessions(): void {
  if (persistTimer) {
    clearInterval(persistTimer);
    persistTimer = null;
  }
  if (dirty) flushSessions();
}
