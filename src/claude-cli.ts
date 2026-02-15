import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { Config, OAIMessage, OAIContentPart, ClaudeStreamLine } from "./types.ts";
import { getTextContent } from "./utils.ts";
import { logger } from "./logger.ts";

/**
 * Validates that the Claude CLI binary exists and is executable.
 * Throws a descriptive error if the binary cannot be found or executed.
 */
export function validateClaudeCli(claudePath: string): void {
  try {
    const output = execFileSync(claudePath, ["--version"], {
      timeout: 10000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    logger.info(`[startup] Claude CLI found: ${output.trim()}`);
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      throw new Error(
        `Claude CLI not found at "${claudePath}". ` +
        `Please install it (https://docs.anthropic.com/en/docs/claude-code) ` +
        `or set CLAUDE_PATH to the correct path.`,
      );
    }
    if (error.code === "EACCES") {
      throw new Error(
        `Claude CLI at "${claudePath}" is not executable. ` +
        `Please check file permissions (chmod +x).`,
      );
    }
    // CLI found but --version failed (maybe different flag) — still usable
    logger.warn(`[startup] Claude CLI found but --version failed: ${error.message}`);
  }
}

export interface ClaudeInvocation {
  process: ChildProcess;
  lineEmitter: AsyncGenerator<ClaudeStreamLine>;
}

const IMAGE_TMP_DIR = join(tmpdir(), "claude-code-proxy-images");

/** Remove all temporary image files created during this session. */
export function cleanupTempImages(): void {
  try {
    if (existsSync(IMAGE_TMP_DIR)) {
      rmSync(IMAGE_TMP_DIR, { recursive: true, force: true });
      logger.info(`[cleanup] Removed temp image directory: ${IMAGE_TMP_DIR}`);
    }
  } catch (err) {
    logger.error(`[cleanup] Failed to remove temp images:`, err);
  }
}

function saveBase64Image(dataUrl: string): string {
  mkdirSync(IMAGE_TMP_DIR, { recursive: true });
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) return "";
  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const filePath = join(IMAGE_TMP_DIR, `${randomUUID()}.${ext}`);
  writeFileSync(filePath, Buffer.from(match[2], "base64"));
  return filePath;
}

/**
 * Extended content extractor that also handles image_url parts
 * by saving base64 images to disk and embedding file paths.
 */
function getTextContentWithImages(content: string | OAIContentPart[]): string {
  if (typeof content === "string") return content;
  const parts: string[] = [];
  for (const p of content) {
    if (p.type === "text" && p.text) {
      parts.push(p.text);
    } else if (p.type === "image_url" && p.image_url?.url) {
      if (p.image_url.url.startsWith("data:image/")) {
        const filePath = saveBase64Image(p.image_url.url);
        if (filePath) {
          parts.push(`[User sent an image, saved at: ${filePath} — use the Read tool to view it]`);
        }
      } else {
        parts.push(`[User sent an image: ${p.image_url.url}]`);
      }
    }
  }
  return parts.join("\n");
}

function buildPrompt(messages: OAIMessage[], hasSession: boolean): string {
  const lastMessage = messages[messages.length - 1];

  if (hasSession) {
    return getTextContentWithImages(lastMessage.content);
  }

  if (messages.length === 1) {
    return getTextContentWithImages(lastMessage.content);
  }

  const nonSystemMessages = messages.filter((m) => m.role !== "system");
  if (nonSystemMessages.length === 1) {
    return getTextContentWithImages(nonSystemMessages[0].content);
  }

  const parts: string[] = [];
  for (const msg of nonSystemMessages) {
    const label = msg.role === "user" ? "User" : "Assistant";
    parts.push(`${label}: ${getTextContentWithImages(msg.content)}`);
  }
  return parts.join("\n\n");
}

export function spawnClaude(
  config: Config,
  messages: OAIMessage[],
  model: string,
  sessionId: string | null,
  workingDir?: string,
): ClaudeInvocation {
  const prompt = buildPrompt(messages, sessionId !== null);
  const systemMessage = messages.find((m) => m.role === "system");

  const args: string[] = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model",
    model,
    "--permission-mode",
    config.claudePermissionMode,
    "--max-turns",
    String(config.claudeMaxTurns),
  ];

  if (sessionId) {
    args.push("--resume", sessionId);
  }

  if (systemMessage) {
    args.push("--system-prompt", getTextContent(systemMessage.content));
  }

  const env = { ...process.env, CLAUDECODE: "" };

  const cwd = workingDir || config.claudeWorkingDir;

  let child: ChildProcess;
  try {
    child = spawn(config.claudePath, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    logger.error(`[claude-cli] Failed to spawn process: ${error.message}`);
    throw new Error(`Failed to start Claude CLI: ${error.message}`);
  }

  // Handle spawn-level errors (e.g. ENOENT if binary disappears after startup)
  child.on("error", (err: Error) => {
    logger.error(`[claude-cli] Process error: ${err.message}`);
  });

  // Kill child if it exceeds timeout
  const timeout = setTimeout(() => {
    logger.warn(`[claude-cli] Timeout after ${config.claudeTimeoutMs}ms, killing process`);
    child.kill("SIGTERM");
    setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 5000);
  }, config.claudeTimeoutMs);

  child.on("exit", (code, signal) => {
    clearTimeout(timeout);
    if (code !== 0 && code !== null) {
      logger.warn(`[claude-cli] Process exited with code ${code}${signal ? ` (signal: ${signal})` : ""}`);
    }
  });

  const lineEmitter = parseStreamLines(child);

  return { process: child, lineEmitter };
}

async function* parseStreamLines(child: ChildProcess): AsyncGenerator<ClaudeStreamLine> {
  let buffer = "";

  const stdout = child.stdout!;

  for await (const chunk of stdout) {
    buffer += chunk.toString();

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);

      if (!line) continue;

      try {
        const parsed = JSON.parse(line) as ClaudeStreamLine;
        yield parsed;
      } catch {
        // Skip non-JSON lines
      }
    }
  }

  // Process any remaining data in buffer
  if (buffer.trim()) {
    try {
      const parsed = JSON.parse(buffer.trim()) as ClaudeStreamLine;
      yield parsed;
    } catch {
      // ignore
    }
  }
}
