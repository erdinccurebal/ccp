// ── OpenAI-compatible types ──

export interface OAIContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string; detail?: string };
}

export interface OAIMessage {
  role: "system" | "user" | "assistant";
  content: string | OAIContentPart[];
}

export interface OAIChatCompletionRequest {
  model: string;
  messages: OAIMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

export interface OAIChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: {
    index: number;
    message: { role: "assistant"; content: string };
    finish_reason: "stop" | "length" | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OAIChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: {
    index: number;
    delta: { role?: "assistant"; content?: string };
    finish_reason: "stop" | "length" | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } | null;
}

export interface OAIModelList {
  object: "list";
  data: {
    id: string;
    object: "model";
    created: number;
    owned_by: string;
  }[];
}

// ── Claude stream-json event types ──

export interface ClaudeStreamEvent {
  type: "stream_event";
  event: {
    type: string;
    index?: number;
    delta?: { type?: string; text?: string; stop_reason?: string; stop_sequence?: string | null };
    content_block?: { type: string; text?: string };
    message?: { id?: string; model?: string; usage?: Record<string, unknown> };
    usage?: Record<string, unknown>;
  };
  session_id?: string;
}

export interface ClaudeResultEvent {
  type: "result";
  session_id: string;
  cost_usd?: number;
  total_cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  is_error?: boolean;
  num_turns?: number;
  result?: string;
}

export interface ClaudeSystemEvent {
  type: "system";
  session_id?: string;
  [key: string]: unknown;
}

export interface ClaudeAssistantEvent {
  type: "assistant";
  message?: { content?: { type: string; text?: string }[] };
  session_id?: string;
  [key: string]: unknown;
}

export type ClaudeStreamLine = ClaudeStreamEvent | ClaudeResultEvent | ClaudeSystemEvent | ClaudeAssistantEvent;

// ── Config ──

export interface Config {
  port: number;
  host: string;
  apiKey: string;
  claudePath: string;
  claudeWorkingDir: string;
  claudePermissionMode: string;
  claudeMaxTurns: number;
  claudeTimeoutMs: number;
  sessionTtlMs: number;
  defaultModel: string;
  corsOrigin: string;
}
