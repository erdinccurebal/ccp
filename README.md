# ccp (Claude Code Proxy)

[![npm](https://img.shields.io/npm/v/@erdinccurebal/ccp)](https://www.npmjs.com/package/@erdinccurebal/ccp) [![license](https://img.shields.io/github/license/erdinccurebal/ccp)](LICENSE) [![node](https://img.shields.io/node/v/@erdinccurebal/ccp)](package.json)

**Website:** [erdinccurebal.github.io/ccp](https://erdinccurebal.github.io/ccp)

OpenAI-compatible API proxy that translates requests into [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) invocations. Supports both **vibe coding** and hands-on development — connect any OpenAI-compatible client (Cursor, Continue, Open WebUI, Cline, Windsurf, etc.) and let Claude Code do the heavy lifting, or step in and guide it when you need precise control.

Developed based on [Cherry Studio](https://github.com/CherryHQ/cherry-studio).

## Prerequisites

- **Node.js** >= 20
- **Claude Code CLI** installed and authenticated (`npm install -g @anthropic-ai/claude-code`)

## Quick Start

```bash
# Install globally
npm install -g @erdinccurebal/ccp

# Configure your API key
ccp config set API_KEY my-secret-key

# Start the server
ccp start
```

If you don't set an API key, the default `CCP_API_KEY` is used and shown on startup.

## CLI Usage

```bash
ccp start                        # Start the proxy server
ccp config set <KEY> <VALUE>     # Set a config value
ccp config get <KEY>             # Get a config value
ccp config list                  # List all config values
ccp config reset <KEY>           # Reset a config value to default
ccp config path                  # Show config file path
ccp config help                  # Show available config keys and values
ccp service install              # Install as system service (autostart)
ccp service uninstall            # Remove system service
ccp service start                # Start the background service
ccp service stop                 # Stop the background service
ccp service status               # Check service status
ccp version                      # Show version
ccp help                         # Show help
```

### Examples

```bash
# Set API key
ccp config set API_KEY my-secret-key

# Change port
ccp config set PORT 3000

# Change default model
ccp config set DEFAULT_MODEL claude-opus-4-6

# View all settings
ccp config list

# See all available config keys and allowed values
ccp config help

# Reset a setting to default
ccp config reset PORT

# Start server (foreground)
ccp start

# Or install and run as background service
ccp service install
ccp service start
```

Config is stored at `~/.ccp/config.json`. Values with predefined options (like `CLAUDE_PERMISSION_MODE`, `DEFAULT_MODEL`, `LOG_LEVEL`) are validated on set — use `ccp config help` to see allowed values.

## Service Management

Run ccp as a background service with autostart on boot.

### macOS (launchd)

```bash
ccp service install    # Creates ~/Library/LaunchAgents/ccp.plist
ccp service start      # Start the service
ccp service status     # Check if running
ccp service stop       # Stop the service
ccp service uninstall  # Remove the service
```

Service logs are written to `~/.ccp/logs/`.

### Linux (systemd)

```bash
ccp service install    # Creates ~/.config/systemd/user/ccp.service
ccp service start      # Start the service
ccp service status     # Check if running
ccp service stop       # Stop the service
ccp service uninstall  # Remove the service
```

### Windows

Service management is not supported on Windows. Use `ccp start` to run the server directly.

### Notes

- `ccp service install` snapshots your current config into the service definition
- If you change config values after install, run `ccp service uninstall && ccp service install` to apply
- The service auto-resolves `CLAUDE_PATH` to an absolute path for compatibility

## Configuration

All settings can be configured via `ccp config set` or environment variables. Environment variables override file config.

| Key | Default | Description |
|---|---|---|
| `API_KEY` | `CCP_API_KEY` | API key for authenticating requests |
| `PORT` | `8888` | Server port |
| `HOST` | `127.0.0.1` | Server bind address |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |
| `CLAUDE_PATH` | `claude` | Path to Claude CLI binary |
| `CLAUDE_WORKING_DIR` | *(cwd)* | Default working directory for Claude |
| `CLAUDE_PERMISSION_MODE` | `default` | Permission mode (`default`, `plan`, `bypassPermissions`) |
| `CLAUDE_MAX_TURNS` | `25` | Max agentic turns per request |
| `CLAUDE_TIMEOUT_MS` | `300000` | Timeout per invocation (5 min) |
| `SESSION_TTL_MS` | `3600000` | Session time-to-live (1 hour) |
| `SESSION_FILE` | *(empty)* | Path to session persistence file |
| `DEFAULT_MODEL` | `claude-sonnet-4-5-20250929` | Default model |
| `LOG_LEVEL` | `info` | Log level (`error`, `warn`, `info`, `debug`) |
| `LOG_FILE` | *(empty)* | Log file path (also logs to console) |
| `LOG_MAX_SIZE` | `10mb` | Max log file size before rotation |
| `LOG_MAX_FILES` | `5` | Number of rotated log backups |

## API Endpoints

### `GET /health`

Health check. Returns `{"status": "ok"}`.

### `GET /v1/models`

Lists available models. Requires `Authorization: Bearer <API_KEY>`.

```bash
curl http://localhost:8888/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### `POST /v1/chat/completions`

OpenAI-compatible chat completions. Supports both streaming and non-streaming.

```bash
# Non-streaming
curl http://localhost:8888/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Streaming
curl http://localhost:8888/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

### Model Aliases

| Alias | Model ID |
|---|---|
| `sonnet` | `claude-sonnet-4-5-20250929` |
| `opus` | `claude-opus-4-6` |
| `haiku` | `claude-haiku-4-5-20251001` |

### Request Tracing

Every request gets a unique `X-Request-Id` header in the response. You can also pass your own via the `X-Request-Id` request header for end-to-end tracing.

### Token Usage

Responses include a `usage` field with `prompt_tokens`, `completion_tokens`, and `total_tokens` when available from the Claude CLI.

## Error Handling

The proxy captures Claude CLI errors and returns them to the client as readable messages instead of empty responses. If Claude CLI exits with an error (e.g., permission denied, timeout, or spawn failure), the stderr output is included in the response content so the client always gets meaningful feedback.

## Working Directory

On the first message in a conversation, the proxy asks the user to provide a working directory path. This is where Claude Code will operate (read/write files, run commands, etc.). Once confirmed, subsequent messages in the same conversation use that directory.

If the conversation already contains assistant responses (i.e. a pre-existing conversation forwarded to the proxy), the default `CLAUDE_WORKING_DIR` is used automatically.

## Session Management

The proxy maintains multi-turn sessions by hashing conversation context and mapping it to Claude Code session IDs. This allows:

- **Continuation**: Follow-up messages in a conversation resume the same Claude session
- **Persistence**: Set `SESSION_FILE` to persist sessions across server restarts
- **Auto-cleanup**: Expired sessions are removed based on `SESSION_TTL_MS`

## Docker

```bash
# Build
docker build -t ccp .

# Run
docker run -p 8888:8888 \
  -e API_KEY=your-secret-key \
  -e CLAUDE_PERMISSION_MODE=default \
  ccp
```

> **Note:** The Claude CLI must be installed inside the container. The Dockerfile does not install it — you'll need to extend the image or mount the binary.

## Development

```bash
# Clone and install
git clone https://github.com/erdinccurebal/ccp.git
cd ccp
npm install

# Development mode with hot-reload
npm run dev

# Build
npm run build

# Type check
npm run typecheck

# Lint & format
npm run lint
npm run format
```

## Project Structure

```
src/
  cli.ts            # CLI entry point (ccp command)
  config.ts         # File-based config management (~/.ccp/config.json)
  service.ts        # Service management (launchd / systemd)
  index.ts          # Server startup, shutdown
  server.ts         # HTTP server, routing, auth, CORS
  completions.ts    # Chat completions handler (streaming + non-streaming)
  claude-cli.ts     # Claude CLI spawning, stream parsing, validation
  session.ts        # Session management with optional file persistence
  logger.ts         # Logger with levels, file output, rotation
  types.ts          # TypeScript type definitions
  utils.ts          # Shared utilities
```

## License

MIT
