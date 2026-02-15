#!/usr/bin/env node

import { loadConfig, setConfigValue, getConfigValue, deleteConfigValue, getConfigFilePath, getDefaults, getConfigSchema } from "./config.ts";
import { handleService } from "./service.ts";

const VERSION = "1.0.0";

function printHelp(): void {
  console.log(`
  ccp - Claude Code Proxy CLI

  Usage:
    ccp start                        Start the proxy server
    ccp config set <KEY> <VALUE>     Set a config value
    ccp config get <KEY>             Get a config value
    ccp config list                  List all config values
    ccp config reset <KEY>           Reset a config value to default
    ccp config path                  Show config file path
    ccp config help                  Show available config keys
    ccp service install              Install as system service (autostart)
    ccp service uninstall            Remove system service
    ccp service start                Start the background service
    ccp service stop                 Stop the background service
    ccp service status               Check service status
    ccp version                      Show version
    ccp help                         Show this help

  Examples:
    ccp config set API_KEY my-secret-key
    ccp config set PORT 3000
    ccp service install && ccp service start
    ccp start
`);
}

function printVersion(): void {
  console.log(`ccp v${VERSION}`);
}

function handleConfigSet(args: string[]): void {
  const key = args[0];
  const value = args.slice(1).join(" ");

  if (!key || !value) {
    console.error("Usage: ccp config set <KEY> <VALUE>");
    process.exit(1);
  }

  const schema = getConfigSchema();
  const meta = schema[key.toUpperCase()];

  if (meta?.values && !meta.values.includes(value)) {
    console.error(`  Invalid value "${value}" for ${key.toUpperCase()}`);
    console.error(`  Allowed values: ${meta.values.join(" | ")}`);
    process.exit(1);
  }

  setConfigValue(key, value);
  console.log(`  ${key.toUpperCase()} = ${value}`);
}

function handleConfigGet(args: string[]): void {
  const key = args[0];
  if (!key) {
    console.error("Usage: ccp config get <KEY>");
    process.exit(1);
  }

  const value = getConfigValue(key);
  if (value !== undefined) {
    console.log(`  ${key.toUpperCase()} = ${value}`);
  } else {
    console.error(`  Key "${key.toUpperCase()}" not found.`);
    process.exit(1);
  }
}

function handleConfigList(): void {
  const config = loadConfig();
  const defaults = getDefaults();
  const schema = getConfigSchema();

  console.log(`\n  Config file: ${getConfigFilePath()}\n`);

  const maxKeyLen = Math.max(...Object.keys(config).map((k) => k.length));
  const maxValLen = 28;

  for (const [key, value] of Object.entries(config)) {
    const isDefault = value === defaults[key];
    const displayValue = key === "API_KEY" && value !== "CCP_API_KEY"
      ? value.slice(0, 4) + "*".repeat(Math.max(0, value.length - 4))
      : value || "(empty)";
    const tag = isDefault ? " (default)" : "";
    const valStr = `${displayValue}${tag}`;
    const desc = schema[key]?.description || "";
    console.log(`  ${key.padEnd(maxKeyLen)}  ${valStr.padEnd(maxValLen)}  ${desc}`);
  }
  console.log();
}

function handleConfigHelp(): void {
  const schema = getConfigSchema();

  console.log(`\n  Available config keys:\n`);

  for (const [key, meta] of Object.entries(schema)) {
    const def = meta.default || "(empty)";
    console.log(`  ${key}`);
    console.log(`    ${meta.description}`);
    console.log(`    Default: ${def}`);
    if (meta.values) {
      console.log(`    Values:  ${meta.values.join(" | ")}`);
    }
    console.log();
  }
  console.log(`  Usage: ccp config set <KEY> <VALUE>`);
  console.log(`  Example: ccp config set API_KEY my-secret-key\n`);
}

function handleConfigReset(args: string[]): void {
  const key = args[0];
  if (!key) {
    console.error("Usage: ccp config reset <KEY>");
    process.exit(1);
  }

  deleteConfigValue(key);
  const value = getConfigValue(key);
  console.log(`  ${key.toUpperCase()} reset to: ${value || "(empty)"}`);
}

function handleConfig(args: string[]): void {
  const subcommand = args[0];
  const rest = args.slice(1);

  switch (subcommand) {
    case "set":
      handleConfigSet(rest);
      break;
    case "get":
      handleConfigGet(rest);
      break;
    case "list":
    case "ls":
      handleConfigList();
      break;
    case "reset":
      handleConfigReset(rest);
      break;
    case "path":
      console.log(`  ${getConfigFilePath()}`);
      break;
    case "help":
      handleConfigHelp();
      break;
    default:
      console.error(`Unknown config command: ${subcommand}`);
      console.error("Usage: ccp config <set|get|list|reset|path|help>");
      process.exit(1);
  }
}

async function handleStart(): Promise<void> {
  // Load config and inject into process.env before importing index
  const config = loadConfig();

  for (const [key, value] of Object.entries(config)) {
    if (value && !process.env[key]) {
      process.env[key] = value;
    }
  }

  // Show config summary
  const apiKey = config.API_KEY || "CCP_API_KEY";
  const isDefaultKey = apiKey === "CCP_API_KEY";

  console.log(`\n  ccp v${VERSION} starting...\n`);

  if (isDefaultKey) {
    console.log(`  API Key:    ${apiKey} (default - set with: ccp config set API_KEY <your-key>)`);
  } else {
    console.log(`  API Key:    ${apiKey.slice(0, 4)}${"*".repeat(Math.max(0, apiKey.length - 4))}`);
  }
  console.log(`  Port:       ${config.PORT || "8888"}`);
  console.log(`  Host:       ${config.HOST || "127.0.0.1"}`);
  console.log(`  Model:      ${config.DEFAULT_MODEL || "claude-sonnet-4-5-20250929"}`);
  console.log(`  Config:     ${getConfigFilePath()}`);
  console.log();

  // Import and run the server
  await import("./index.ts");
}

// ── Main ──

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "start":
  case undefined:
    handleStart();
    break;
  case "config":
    handleConfig(args.slice(1));
    break;
  case "service":
    handleService(args.slice(1));
    break;
  case "version":
  case "-v":
  case "--version":
    printVersion();
    break;
  case "help":
  case "-h":
  case "--help":
    printHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
