import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".ccp");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export type ConfigData = Record<string, string>;

export interface ConfigMeta {
  default: string;
  description: string;
  values?: string[];
}

const CONFIG_SCHEMA: Record<string, ConfigMeta> = {
  API_KEY:                { default: "CCP_API_KEY",                description: "API key for authenticating requests" },
  PORT:                   { default: "8888",                       description: "Server port" },
  HOST:                   { default: "127.0.0.1",                  description: "Server bind address" },
  CORS_ORIGIN:            { default: "*",                          description: "Allowed CORS origin" },
  CLAUDE_PATH:            { default: "claude",                     description: "Path to Claude CLI binary" },
  CLAUDE_WORKING_DIR:     { default: "",                           description: "Default working directory for Claude" },
  CLAUDE_PERMISSION_MODE: { default: "default",                    description: "Permission mode",                       values: ["default", "plan", "bypassPermissions"] },
  CLAUDE_MAX_TURNS:       { default: "25",                         description: "Max agentic turns per request" },
  CLAUDE_TIMEOUT_MS:      { default: "300000",                     description: "Timeout per invocation in ms" },
  SESSION_TTL_MS:         { default: "3600000",                    description: "Session time-to-live in ms" },
  SESSION_FILE:           { default: "",                           description: "Session persistence file path" },
  DEFAULT_MODEL:          { default: "claude-sonnet-4-5-20250929", description: "Default model",                         values: ["claude-sonnet-4-5-20250929", "claude-opus-4-6", "claude-haiku-4-5-20251001", "sonnet", "opus", "haiku"] },
  LOG_LEVEL:              { default: "info",                       description: "Log level",                             values: ["error", "warn", "info", "debug"] },
  LOG_FILE:               { default: "",                           description: "Log file path (empty = console only)" },
  LOG_MAX_SIZE:           { default: "10mb",                       description: "Max log file size before rotation" },
  LOG_MAX_FILES:          { default: "5",                          description: "Number of rotated log backups to keep" },
};

const DEFAULTS: ConfigData = Object.fromEntries(
  Object.entries(CONFIG_SCHEMA).map(([k, v]) => [k, v.default]),
);

export function getConfigSchema(): Record<string, ConfigMeta> {
  return CONFIG_SCHEMA;
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): ConfigData {
  ensureConfigDir();
  if (!existsSync(CONFIG_FILE)) {
    return { ...DEFAULTS };
  }
  try {
    const data = JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as ConfigData;
    return { ...DEFAULTS, ...data };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(config: ConfigData): void {
  ensureConfigDir();
  // Only save non-default values
  const toSave: ConfigData = {};
  for (const [key, value] of Object.entries(config)) {
    if (value !== DEFAULTS[key]) {
      toSave[key] = value;
    }
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2) + "\n", "utf-8");
}

export function getConfigValue(key: string): string | undefined {
  const config = loadConfig();
  return config[key.toUpperCase()];
}

export function setConfigValue(key: string, value: string): void {
  const config = loadConfig();
  config[key.toUpperCase()] = value;
  saveConfig(config);
}

export function deleteConfigValue(key: string): void {
  const config = loadConfig();
  const upper = key.toUpperCase();
  if (DEFAULTS[upper] !== undefined) {
    config[upper] = DEFAULTS[upper];
  } else {
    delete config[upper];
  }
  saveConfig(config);
}

export function getConfigFilePath(): string {
  return CONFIG_FILE;
}

export function getDefaults(): ConfigData {
  return { ...DEFAULTS };
}
