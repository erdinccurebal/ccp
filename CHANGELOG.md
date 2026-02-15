# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-02-14

### Added

- OpenAI-compatible `/v1/chat/completions` endpoint (streaming and non-streaming)
- `/v1/models` endpoint listing available Claude models
- `/health` health-check endpoint
- Bearer token authentication
- Automatic session management with hash-based lookup
- Working directory selection via conversation flow
- Image support (base64 and URL) in message content
- Model aliases (`sonnet`, `opus`, `haiku`)
- Configurable CORS origin
- Graceful shutdown with `SIGTERM`/`SIGINT` handling
- Temporary image cleanup on shutdown
- Docker support with multi-stage build
