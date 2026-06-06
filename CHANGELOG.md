# Changelog

All notable changes to this project will be documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1] - 2026-06-06

Docs sweep, README rewrite, repo cleanup. No code changes other than the version bump and a small script under `tools/`.

### Added

- **`tools/generate-llms-txt.mjs`** — regenerates `llms.txt` by concatenating every page referenced from `docs/src/SUMMARY.md` in order. Run after any docs change.
- **`docs/src/reclaim.md`, `security.md`, `connect.md`, `backups.md`, `session-detail.md`** — new pages for the post-rebuild UI surfaces.

### Changed

- **README** rewritten for 0.4.0 reality: drops the "before Claude tells you images are too big" framing, leads with the four things ConClear actually does (reclaim, redact, recover, MCP bridge), adds the security loop section, updates the capability matrix and MCP tools list, refreshes keyboard shortcuts to match the rebuild.
- **`skill.md`** — adds `conclear scan` to the command table and `conclear_files` / `conclear_scan_secrets` to the MCP surface so agents reading the skill see the full toolset.
- **`docs/src/`** — `web-ui.md`, `secret-scanning.md`, `mcp-server.md`, `operations.md`, `supported-tools.md`, `introduction.md`, `what-is-conclear.md`, and per-tool pages for Cline / Cursor / Gemini all updated to reflect 0.4.0 capability parity. SUMMARY restructured: top-level pages now cover the post-rebuild UI (Reclaim / Sessions / Security / Connect / Backups) and session-detail tabs are grouped separately.
- **`llms.txt`** regenerated from the new docs.

### Removed

- **`docs/screenshots/v0.2/` and `docs/screenshots/demo-*.png`** — pre-rebuild UI captures the README had been pointing at. Fresh 0.4 captures will land separately.
- **`docs/src/disk-usage.md`** — content folded into `reclaim.md` and `backups.md`.

### Git history

Every commit prior to this release was rewritten to strip `Co-Authored-By: Claude *` and `Generated with Claude Code` lines. GitHub renders those as collaborators on the repo contributor list, which had caused real social friction. The factual product references in commit prose ("Claude Code JSONL parser", etc.) were preserved — those describe what ConClear supports.

## [0.4.0] - 2026-06-03

Closes the security loop end-to-end and brings every adapter except Copilot up to capability parity for the things that actually matter (scan / redact / export). The single biggest gap from earlier releases — "ConClear's interesting features only work on Claude Code sessions" — is closed.

### Added

- **Cline scan + redact + export.** `scanClineSecrets`, `redactClineSecrets`, `exportClineMarkdown` walk the Anthropic-shaped `api_conversation_history.json`, scan every text / tool_use / tool_result block, and pretty-print the JSON back when redacting.
- **Gemini scan + redact + export.** Handles string content, `{ text }` objects, and `parts[]` arrays. Redact preserves the file shape.
- **Cursor scan.** Walks every bubble in a composer (text + toolFormerData.rawArgs + result) via the existing read-only SQLite handle. Redact for Cursor is intentionally deferred — rewriting SQLite blobs while Cursor is running is risky and the rotate-the-credential workflow (via the rotate links shipped this release) covers the user need.
- **MCP tools `conclear_scan_secrets` + `conclear_files`.** Agents can now scan a session for leaked credentials and list files touched, without going through the web UI. Both honestly degrade for adapters that don't support the capability.
- **Rotate-this-key links.** Every Security finding shows a "Rotate at provider X" link next to the redact button. Known mappings: OpenAI / Anthropic, AWS IAM, GitHub tokens, GitHub SSH keys. Bearer / database / webhook / env credentials fall back to a "rotate the credential" label with no link, since the provider is ambiguous.
- **Restore-from-backup.** `POST /api/backups/:name/restore` reads a sidecar metadata file written alongside each backup and copies it back over the original session file. Backups page shows the action that produced the backup (strip / resize / redact) and the original path; legacy backups (pre-0.4) get a disabled Restore button with an explanatory tooltip.
- **First-run onboarding banner.** When no clients are MCP-installed yet, Reclaim shows a one-shot prompt that links to Connect with the bulk-install primed. Dismissable; remembered in localStorage.
- **README badges** — npm version, monthly downloads, CI status, license.
- **CHANGELOG entries** for 0.3.0 and 0.3.1 (previously skipped).

### Changed

- **Shared secret-scanning module** (`src/server/adapters/secrets.ts`). The pattern table, `redactSecret`, `extractContext`, `scanText`, `redactText`, and `sortFindings` are now one source of truth used by every adapter. The Claude parser still owns its JSONL streaming loop but delegates the matching itself.
- **Backups now write a `.meta.json` sidecar** containing `{ origPath, action, createdAt }`. Lets the Backups page surface what each backup is and where it came from, and powers Restore. Sidecars are filtered out of the listing so they don't appear as their own entries.
- **Capability matrix** updated to reflect adapter parity: Cursor / Gemini / Cline gain `scanSecrets`; Gemini / Cline gain `exportSession`.

### Tests

- 17 new test cases across Claude (existing), Cline, and Gemini redact pipelines: pattern coverage, line filter, type filter, content-shape preservation, scan-after-redact validation. **38 tests total** (was 21 before 0.3.1).

### Known limitations

- **Cursor redact** not implemented. Use the rotate links to roll the credential; delete the session inside Cursor itself if you want the data gone.
- **Copilot Chat** remains read-only: parser exists but no scan / redact / export. Lower priority — Copilot's data is the smallest of the five and rarely contains pasted credentials in the wild.
- **Windsurf** still install-only (chats are encrypted protobuf).

## [0.3.1] - 2026-06-03

End-user polish pass on top of 0.3.0 — fixes things you notice within the first minute of using the app.

### Added

- **Working bulk + per-finding redact.** `redactSecretsInFile` parser, `redactSecrets` adapter method (Claude), and `POST /api/sessions/:id/redact` route. Every redact writes a verified timestamped backup to `~/.conclear/backups/` before rewriting the session file. UI: "Redact all" on both the global Security page and the per-session Security tab; scissors button on every finding row to redact just that line.
- **Shared scan cache.** Module-level singleton store backs the sidebar Security count, the global Security page, the per-session Security tab, and the SessionDetail header badge. No more rescanning every time you navigate. Rehydrates from localStorage on cold start so something paints instantly.
- **Sessions list cached on first paint.** `useSessions` hydrates from `localStorage` (`conclear.sessions.v1`) before the network round-trip; background refresh updates when ready. Errors no longer wipe the cached list.
- **Real image thumbnails.** Images tab and lightbox render from `/api/sessions/:id/images/:imageId` instead of colored gradient placeholders. Stripped images still fall back to a gradient.

### Changed

- **Timeline paginates at 200 rows.** Huge sessions no longer trigger Firefox's "page slowing down" warning. "Show N more" button to expand. Non-expandable rows now render with `cursor: default` so the click affordance is honest.
- **Claude project directories decoded for display.** `-Volumes-4tbCache--Projects-ConClear` → `ConClear` in session group headers, overview lists, and detail view. The raw form is still used as the internal key.
- **Titlebar MCP chip** no longer claims "running." ConClear's MCP server is spawned on demand by each client; the chip now reflects that and links to Connect.
- **Sidebar Security count** flips to alert styling when findings > 0.

### Fixed

- **Per-session Security tab re-scanned every visit.** It now reads from the shared cache and only fetches when uncached.

## [0.3.0] - 2026-06-02

UI rebuild on the Claude Design system + first-class Connect page wired to real install endpoints.

### Added

- **Full UI rebuild** from the Claude Design system (Signal Lime accent, Space Grotesk / Hanken Grotesk / JetBrains Mono). Dark-only. New Reclaim / Sessions / Security / Connect / Backups / Settings / Upgrade pages.
- **Connect page** wired to real `/api/install/*` endpoints — bulk install into every detected client, per-client MCP + Skill toggles with busy state, JSON snippet copy for manual config, modal with paste-this instructions for clients ConClear can't auto-edit (Continue).
- **Demo mode.** `conclear --demo` (or `CONCLEAR_DEMO_ROOT` env var) reroots every adapter at bundled fixtures so the app launches without scanning real session data — useful for screenshots and first-time exploration.
- **Global search palette** (Cmd+K) across every session, message, and file.

### Changed

- **Capability matrix is honest.** The client-side `TOOLS` table no longer claims `scanSecrets: true` for adapters that don't implement it. Cursor / Gemini / Copilot rows accurately reflect "session reading only."
- **Admin / Workspace surfaces** preserved in the source tree but no longer imported; Vite tree-shakes them out of the shipped bundle. Reattached for the v0.4+ Pro/Teams desktop build.

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
