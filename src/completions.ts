import { randomUUID } from "node:crypto";
import { existsSync, statSync, realpathSync } from "node:fs";
import { resolve, normalize } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  Config,
  OAIChatCompletionRequest,
  OAIChatCompletionResponse,
  OAIChatCompletionChunk,
  OAIMessage,
  ClaudeStreamLine,
} from "./types.ts";
import { spawnClaude } from "./claude-cli.ts";
import { lookupSession, storeSession } from "./session.ts";
import { getTextContent } from "./utils.ts";
import { logger } from "./logger.ts";

function isValidDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function resolvePath(text: string): string | null {
  let resolved: string;
  if (text.startsWith("~")) {
    resolved = text.replace("~", process.env.HOME || "");
  } else if (text.startsWith("/")) {
    resolved = text;
  } else {
    return null;
  }

  // Normalize and resolve to prevent path traversal
  resolved = resolve(normalize(resolved));

  // Reject paths that try to access sensitive system directories
  const blockedPrefixes = ["/proc", "/sys", "/dev"];
  if (blockedPrefixes.some((prefix) => resolved.startsWith(prefix))) {
    return null;
  }

  // Resolve symlinks to get the real path
  try {
    if (existsSync(resolved)) {
      resolved = realpathSync(resolved);
    }
  } catch {
    // If we can't resolve, continue with the normalized path
  }

  return resolved;
}

const PATH_PROMPT = "📁 Please enter the working directory path (e.g.: ~/projects/myapp)";
const PATH_INVALID = "❌ Invalid directory path. Please enter a valid existing directory path (e.g.: ~/projects/myapp)";
const PATH_CONFIRMED = (p: string) => `✅ Working directory set: \`${p}\`\n\nNow working in this directory. How can I help you?`;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function resolveModel(requestModel: string, defaultModel: string): string {
  const aliases: Record<string, string> = {
    sonnet: "claude-sonnet-4-5-20250929",
    opus: "claude-opus-4-6",
    haiku: "claude-haiku-4-5-20251001",
  };
  return aliases[requestModel] || requestModel || defaultModel;
}

export async function handleChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config,
  requestId?: string,
): Promise<void> {
  const body = await readBody(req);
  let request: OAIChatCompletionRequest;

  try {
    request = JSON.parse(body);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Invalid JSON body", type: "invalid_request_error" } }));
    return;
  }

  if (!request.messages || request.messages.length === 0) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "messages is required", type: "invalid_request_error" } }));
    return;
  }

  const model = resolveModel(request.model, config.defaultModel);
  const completionId = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  const rid = requestId || completionId;

  // Find a confirmed working directory in the conversation.
  // A path is "confirmed" only if a valid path user message is followed by an assistant response.
  const userAssistantMessages = request.messages.filter((m) => m.role !== "system");

  let confirmedPath: string | null = null;
  let pathUserIdx = -1;
  let pathAssistantIdx = -1;

  for (let i = 0; i < userAssistantMessages.length; i++) {
    const msg = userAssistantMessages[i];
    if (msg.role !== "user") continue;

    const text = getTextContent(msg.content).trim();
    const resolved = resolvePath(text);
    if (!resolved || !isValidDirectory(resolved)) continue;

    // Check if there's an assistant response after this message (= confirmed)
    const nextMsg = userAssistantMessages[i + 1];
    if (nextMsg && nextMsg.role === "assistant") {
      confirmedPath = resolved;
      pathUserIdx = i;
      pathAssistantIdx = i + 1;
      break;
    }
  }

  // Last user message
  const userMessages = userAssistantMessages.filter((m) => m.role === "user");
  const lastUserMsg = userMessages[userMessages.length - 1];
  const lastUserText = lastUserMsg ? getTextContent(lastUserMsg.content).trim() : "";

  // No confirmed path yet
  if (!confirmedPath) {
    // Check if this is a pre-existing conversation (has assistant responses not from our path system)
    const hasRealAssistantResponse = userAssistantMessages.some(
      (m) => m.role === "assistant" && !getTextContent(m.content).startsWith("✅") && !getTextContent(m.content).startsWith("📁") && !getTextContent(m.content).startsWith("❌"),
    );

    if (hasRealAssistantResponse) {
      // Pre-existing conversation without path — use default cwd, pass all messages
      logger.info(`[completions] (${rid}) Pre-existing conversation, using default cwd`);
      const claudeMessages = request.messages;
      const contextMessages = claudeMessages.slice(0, -1);
      const sessionId = lookupSession(contextMessages);

      logger.info(
        `[completions] (${rid}) model=${model} messages=${claudeMessages.length} stream=${!!request.stream} session=${sessionId ? "resumed" : "new"} cwd=${config.claudeWorkingDir}`,
      );

      const { lineEmitter, process: child } = spawnClaude(config, claudeMessages, model, sessionId);
      const stderr = { output: "" };
      child.stderr?.on("data", (chunk: Buffer) => { stderr.output += chunk.toString(); });

      if (request.stream) {
        await handleStreaming(res, lineEmitter, child, completionId, created, model, claudeMessages, stderr);
      } else {
        await handleNonStreaming(res, lineEmitter, child, completionId, created, model, claudeMessages, stderr);
      }
      return;
    }

    // New conversation — enforce path requirement
    const resolved = resolvePath(lastUserText);

    if (resolved && isValidDirectory(resolved)) {
      logger.info(`[completions] (${rid}) Working directory set: ${resolved}`);
      sendFakeResponse(res, completionId, created, model, PATH_CONFIRMED(resolved), request.stream);
      return;
    }

    if (resolved !== null) {
      sendFakeResponse(res, completionId, created, model, PATH_INVALID, request.stream);
      return;
    }

    sendFakeResponse(res, completionId, created, model, PATH_PROMPT, request.stream);
    return;
  }

  const workingDir = confirmedPath;

  // Strip the path exchange pair from messages sent to Claude
  const claudeMessages = [...request.messages.filter((m) => m.role === "system")];
  for (let i = 0; i < userAssistantMessages.length; i++) {
    if (i === pathUserIdx || i === pathAssistantIdx) continue;
    claudeMessages.push(userAssistantMessages[i]);
  }

  // Session lookup: hash context (all except last user message) to find existing session
  const contextMessages = claudeMessages.slice(0, -1);
  const sessionId = lookupSession(contextMessages);

  logger.info(
    `[completions] (${rid}) model=${model} messages=${claudeMessages.length} stream=${!!request.stream} session=${sessionId ? "resumed" : "new"} cwd=${workingDir}`,
  );

  const { lineEmitter, process: child } = spawnClaude(config, claudeMessages, model, sessionId, workingDir);

  // Capture stderr for error reporting (object ref so async writes are visible)
  const stderr = { output: "" };
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr.output += chunk.toString();
  });

  if (request.stream) {
    await handleStreaming(res, lineEmitter, child, completionId, created, model, claudeMessages, stderr);
  } else {
    await handleNonStreaming(res, lineEmitter, child, completionId, created, model, claudeMessages, stderr);
  }
}

function sendFakeResponse(
  res: ServerResponse,
  completionId: string,
  created: number,
  model: string,
  content: string,
  stream?: boolean,
): void {
  if (stream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    const roleChunk: OAIChatCompletionChunk = {
      id: completionId, object: "chat.completion.chunk", created, model,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    };
    res.write(`data: ${JSON.stringify(roleChunk)}\n\n`);
    const contentChunk: OAIChatCompletionChunk = {
      id: completionId, object: "chat.completion.chunk", created, model,
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    };
    res.write(`data: ${JSON.stringify(contentChunk)}\n\n`);
    const stopChunk: OAIChatCompletionChunk = {
      id: completionId, object: "chat.completion.chunk", created, model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    };
    res.write(`data: ${JSON.stringify(stopChunk)}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  } else {
    const response: OAIChatCompletionResponse = {
      id: completionId, object: "chat.completion", created, model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    };
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(response));
  }
}

async function handleStreaming(
  res: ServerResponse,
  lineEmitter: AsyncGenerator<ClaudeStreamLine>,
  child: ReturnType<typeof import("node:child_process").spawn>,
  completionId: string,
  created: number,
  model: string,
  messages: OAIMessage[],
  stderr: { output: string },
): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  // Send initial role chunk
  const initialChunk: OAIChatCompletionChunk = {
    id: completionId,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  };
  res.write(`data: ${JSON.stringify(initialChunk)}\n\n`);

  let resultSessionId: string | null = null;
  let assistantContent = "";
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  let streamFinishedCleanly = false;

  // Abort stream if client disconnects
  const onClose = () => {
    if (!streamFinishedCleanly) {
      logger.warn(`[completions] Client disconnected mid-stream (${completionId})`);
      child.kill("SIGTERM");
    }
  };
  res.on("close", onClose);

  try {
    for await (const line of lineEmitter) {
      // Stop writing if the response is already closed (client disconnect)
      if (res.destroyed) break;

      if (line.type === "stream_event") {
        const event = line.event;

        // Capture usage from message_start
        if (event.type === "message_start" && event.message?.usage) {
          const u = event.message.usage as Record<string, number>;
          if (u.input_tokens) usage.prompt_tokens += u.input_tokens;
          if (u.output_tokens) usage.completion_tokens += u.output_tokens;
        }

        // Capture usage from message_delta
        if (event.type === "message_delta" && event.usage) {
          const u = event.usage as Record<string, number>;
          if (u.output_tokens) usage.completion_tokens = u.output_tokens;
        }

        if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
          assistantContent += event.delta.text;
          const chunk: OAIChatCompletionChunk = {
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: { content: event.delta.text }, finish_reason: null }],
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        } else if (event.type === "message_delta" && event.delta?.stop_reason) {
          usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
          const chunk: OAIChatCompletionChunk = {
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: usage.total_tokens > 0 ? usage : null,
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      } else if (line.type === "result") {
        resultSessionId = line.session_id;
        if (line.is_error && line.result) {
          // Send error as a final content chunk so the client sees it
          const errorChunk: OAIChatCompletionChunk = {
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: { content: `\n\n[Error: ${line.result}]` }, finish_reason: null }],
          };
          if (!res.destroyed) res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
          assistantContent += `\n\n[Error: ${line.result}]`;
        }
      }
    }
  } catch (err) {
    logger.error(`[completions] Stream error (${completionId}):`, err);
    // Try to send an error indication to the client
    if (!res.destroyed) {
      try {
        const errorChunk: OAIChatCompletionChunk = {
          id: completionId,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: { content: "\n\n[Stream interrupted due to an internal error]" }, finish_reason: null }],
        };
        res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
      } catch {
        // Response may already be closed
      }
    }
  }

  streamFinishedCleanly = true;

  // If no content was generated and stderr has output, send error to client
  if (!assistantContent && stderr.output && !res.destroyed) {
    const errMsg = stderr.output.trim();
    logger.warn(`[completions] CLI produced no output, stderr: ${errMsg}`);
    const errorChunk: OAIChatCompletionChunk = {
      id: completionId,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: { content: `Error: ${errMsg}` }, finish_reason: null }],
    };
    res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
    assistantContent = `Error: ${errMsg}`;
  }

  if (!res.destroyed) {
    // Send stop chunk if not already sent
    if (!assistantContent.includes("[Error:") || assistantContent.startsWith("Error:")) {
      const stopChunk: OAIChatCompletionChunk = {
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      };
      res.write(`data: ${JSON.stringify(stopChunk)}\n\n`);
    }
    res.write("data: [DONE]\n\n");
    res.end();
  }

  if (usage.total_tokens > 0) {
    logger.debug(`[usage] (${completionId}) prompt=${usage.prompt_tokens} completion=${usage.completion_tokens} total=${usage.total_tokens}`);
  }

  // Store session mapping for future multi-turn
  if (resultSessionId) {
    const fullContext: OAIMessage[] = [
      ...messages,
      { role: "assistant", content: assistantContent },
    ];
    storeSession(fullContext, resultSessionId);
    logger.debug(`[session] Stored session ${resultSessionId}`);
  }
}

async function handleNonStreaming(
  res: ServerResponse,
  lineEmitter: AsyncGenerator<ClaudeStreamLine>,
  child: ReturnType<typeof import("node:child_process").spawn>,
  completionId: string,
  created: number,
  model: string,
  messages: OAIMessage[],
  stderr: { output: string },
): Promise<void> {
  let assistantContent = "";
  let resultSessionId: string | null = null;
  let finishReason: "stop" | "length" = "stop";
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  try {
    for await (const line of lineEmitter) {
      if (line.type === "stream_event") {
        const event = line.event;

        // Capture usage from message_start
        if (event.type === "message_start" && event.message?.usage) {
          const u = event.message.usage as Record<string, number>;
          if (u.input_tokens) usage.prompt_tokens += u.input_tokens;
          if (u.output_tokens) usage.completion_tokens += u.output_tokens;
        }

        // Capture usage from message_delta
        if (event.type === "message_delta" && event.usage) {
          const u = event.usage as Record<string, number>;
          if (u.output_tokens) usage.completion_tokens = u.output_tokens;
        }

        if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
          assistantContent += event.delta.text;
        } else if (event.type === "message_delta" && event.delta?.stop_reason) {
          finishReason = event.delta.stop_reason === "end_turn" ? "stop" : "length";
        }
      } else if (line.type === "result") {
        resultSessionId = line.session_id;
        if (line.is_error && line.result) {
          assistantContent = line.result;
        }
      }
    }
  } catch (err) {
    logger.error("[completions] Error:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Claude CLI error", type: "server_error" } }));
    return;
  }

  // If no content was generated and stderr has output, send error to client
  if (!assistantContent && stderr.output) {
    const errMsg = stderr.output.trim();
    logger.warn(`[completions] CLI produced no output, stderr: ${errMsg}`);
    assistantContent = `Error: ${errMsg}`;
  }

  usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;

  const response: OAIChatCompletionResponse = {
    id: completionId,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: assistantContent },
        finish_reason: finishReason,
      },
    ],
    usage: usage.total_tokens > 0 ? usage : undefined,
  };

  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(response));

  if (usage.total_tokens > 0) {
    logger.debug(`[usage] (${completionId}) prompt=${usage.prompt_tokens} completion=${usage.completion_tokens} total=${usage.total_tokens}`);
  }

  // Store session mapping
  if (resultSessionId) {
    const fullContext: OAIMessage[] = [
      ...messages,
      { role: "assistant", content: assistantContent },
    ];
    storeSession(fullContext, resultSessionId);
    logger.debug(`[session] Stored session ${resultSessionId}`);
  }
}
