# Changelog

All notable changes to this project will be documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-06-02

The 0.1.0 → 0.2.0 release adds a one-command MCP installer for 11 AI clients, extends every CLI / MCP query command to read across every supported AI tool (not just Claude Code), and ships a first set of automated tests.

### Added

- **`conclear install` / `uninstall` / `doctor`** — one-command setup of the ConClear MCP server into 11 AI clients: Claude Code, Claude Desktop, Cursor, Windsurf, VS Code (Copilot Chat), Google Antigravity, Zed, Cline, Continue, Codex CLI, Kiro CLI. Skill install for Claude Code, Cursor (v2.2+), and Antigravity. Atomic writes with timestamped backups in `~/.conclear/backups/`. Each client routes through its preferred channel: client-provided CLI where available (`claude mcp add`, `code --add-mcp`, `codex mcp add`), JSON file merge, JSONC-safe merge for Zed (preserves comments + formatting), or printed snippet for YAML-only clients (Continue).
- **`conclear mcp --http [--port N]`** — Streamable HTTP transport for the MCP server. Stdio remains the default; SSE is not implemented (deprecated upstream).
- **Multi-adapter coverage for CLI commands.** `conclear sessions`, `search`, `summary`, `context`, `files`, `export`, `scan` now operate across every detected AI tool — previously they only saw Claude Code. Unsupported features per tool degrade with a clear message instead of throwing.
- **Multi-adapter coverage for MCP server.** `conclear_sessions`, `conclear_search`, `conclear_summary`, `conclear_context`, `conclear_file_content` now route through every detected adapter.
- **Cline / Roo Code file history.** `getFileHistory` + `getFileContent` recover read / write / replace_in_file content from Cline's `api_conversation_history.json`. Both surface through CLI, MCP, and REST.
- **Cline token / cost analytics.** `Session.usage` (optional) exposes `tokensIn`, `tokensOut`, `cacheReads`, `cacheWrites`, `totalCostUsd` parsed from `task_metadata.json`. Surfaced in `conclear summary` and the MCP `conclear_sessions` JSON.
- **Cursor SQLite-aware search.** New per-adapter `searchMessages` hook lets Cursor query bubble JSON via SQL LIKE instead of returning nothing through the line-based default. Verified end-to-end on a real Cursor DB.
- **Force-rescan.** `GET /sessions?refresh=true` and `GET /search?refresh=true` clear every adapter's mtime cache before re-parsing. New `clearCache()` method on the Adapter interface.
- **Test suite + CI.** `vitest` covers the highest-risk new code: install JSON-merge round-trips, Zed JSONC comment preservation, Cline file-history extraction (read / write / replace_in_file), and the Copilot session-name regression. `.github/workflows/ci.yml` runs `npm run build && npm test` on every push and PR (Ubuntu + macOS, Node 22). `prepublishOnly` now runs tests before publishing.
- **`docs/src/what-is-conclear.md`** — honest capability matrix grouped by *Manage / Query / Integrate*, including emergent uses and known limitations.

### Changed

- **Adapter interface** (`src/server/adapters/types.ts`) — `getConversation`, `getFileHistory`, `getFileContent`, `scanSecrets`, `exportSession`, `resizeImages`, `searchMessages`, `clearCache` are now first-class optional methods. Every `(adapter as any).foo()` cast in `routes/sessions.ts`, `mcp-server.ts`, and `cli-query.ts` is gone. `capabilitiesOf(adapter)` returns a structured snapshot.
- **Single adapter registry** (`src/server/adapters/registry.ts`) used by REST, MCP, and CLI — previously each surface instantiated its own adapter list.
- **`BACKUP_DIR`** centralized in `src/server/adapters/constants.ts` instead of duplicated across five adapters.
- **`ChatMessage`** gains an optional `toolCall: { name, args?, result?, status? }` field so adapters like Cursor can expose structured tool calls without losing type safety.

### Fixed

- **Copilot session names** no longer render as `[object Object] — [object Object]` when `mode` or `selectedModel` are objects. Non-string values are skipped; the name becomes `null` rather than nonsense.

### Known limitations

- **Windsurf chat reading.** Cascade conversations are stored as encrypted protobuf in `~/.codeium/windsurf/cascade/*.pb`. ConClear can install its MCP server into Windsurf (`conclear install --windsurf`) but cannot read Windsurf chat history.
- **Cursor file history.** Cursor stores tool calls in `toolFormerData` SQLite blobs. Surface area is identified but extraction is not wired into `getFileHistory`. File recovery works for Claude Code and Cline today.
- **Markdown export and secret scanning** remain Claude Code only. The Cline data shape (Anthropic-shaped) is equivalent and the lift is mostly mechanical, but it is not yet wired.
- **Continue install** is manual: `conclear install --continue` prints a YAML snippet to paste. Adding a YAML parser dependency to automate it is intentionally deferred.

### Internal

- `src/cli-query.ts` split into per-command modules under `src/cli-query/`. The barrel `src/cli-query.ts` re-exports.
- Search logic consolidated into `src/server/search.ts` with a single `searchAllAdapters` entry point used by REST, MCP, and CLI.
- `skill.md` now ships in the npm tarball (previously omitted, which would have broken `conclear install --claude-code` for npm users).
- Repository normalized for npm publish: canonical `git+https` URL and `dist/cli.js` bin path.

## [0.1.0] - 2025-09-18 (approximate)

Initial public release. Visual web UI, CLI query commands for Claude Code session data, stdio MCP server, image strip / resize / restore, secret scanning, markdown export, file-version recovery, multi-tool session reading (Claude Code, Cursor, Gemini CLI, Cline / Roo Code, GitHub Copilot Chat).
