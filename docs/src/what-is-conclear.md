# What is ConClear?

> **A session history layer for AI coding tools.** It treats your past AI sessions as a first-class, queryable, mutable resource — the way `git` treats code history.

ConClear started as a way to clean up screenshot bloat in Claude Code session files. As more adapters were added and the MCP server matured, it turned into something bigger: a unified reader, writer, search engine, and integration layer for the session data of every major AI coding assistant. This page is the honest map of what's actually possible today — including emergent uses we didn't design for, and gaps where features exist for one tool but not yet others.

## Three modes

| Mode | What it does | Primary interfaces |
|---|---|---|
| **Manage** | Strip screenshots, resize images, delete bloat, recover files, scan for leaked secrets | Web UI, REST API, CLI |
| **Query** | Search, summarize, replay, export sessions | Web UI, CLI, MCP server |
| **Integrate** | Install ConClear's MCP (and Skill) into AI clients in one command | `conclear install` CLI |

## Capability matrix

Capabilities are grouped by *what the agent or user can do*. For each row: which AI tools' session data the capability applies to today, and which surfaces expose it.

### Discover / list

| Capability | Tools | Surfaces |
|---|---|---|
| Auto-detect installed AI tools by probing data dirs | claude, cursor, cline, gemini, copilot | UI, REST |
| Unified session list across all detected tools, sorted by last active | all 5 | UI, MCP `conclear_sessions`, REST |
| Filter sessions by project name | all 5 | UI, CLI, MCP, REST |
| mtime-keyed cache so repeated scans are fast | all 5 | (internal) |

### Read / inspect a session

| Capability | Tools | Surfaces |
|---|---|---|
| Per-session detail (metadata, image inventory, tool-result bytes) | all 5 | UI, REST `GET /sessions/:id`, MCP `conclear_summary` |
| Clean conversation (user/assistant text only, system tags stripped) | all 5 | UI, CLI `context`, MCP `conclear_context`, REST |
| Per-image preview + full base64 fetch | all 5 | UI, REST |
| Image dimension inference from base64 header (no full decode) | all 5 | (internal — surfaces as "oversized image" warning) |
| Token / cost analytics from the tool's own metadata | cline | UI, MCP, REST `Session.usage` |

### Files & versions

| Capability | Tools | Surfaces |
|---|---|---|
| List every file the agent read / edited / wrote, with N versions | claude, cline | CLI `files`, MCP `conclear_files` / `conclear_file_content`, REST `GET /sessions/:id/files` |
| Retrieve the full content of a specific file version | claude, cline | CLI `files --latest`, MCP `conclear_file_content`, REST `GET /sessions/:id/files/:lineNumber` |
| Glob/regex match on file paths across sessions | claude, cline | CLI `conclear files <pattern>` |

### Search

| Capability | Tools | Surfaces |
|---|---|---|
| Global text search over messages across every detected tool | claude, cline (best); copilot/gemini/cursor (best-effort) | UI `Cmd+K`, MCP `conclear_search`, REST `GET /search` |
| System-tag stripping so hook/sysprompt noise doesn't pollute results | all 5 | (always on) |

Why "best-effort" for some: search reads files line-by-line and looks for Anthropic-shaped JSON. Claude (JSONL) and Cline (JSON array) match cleanly. Copilot's single-JSON, Cursor's SQLite blobs, and Gemini's per-chat JSON degrade gracefully — they just match less.

### Mutate (with mandatory timestamped backup)

| Capability | Tools | Surfaces |
|---|---|---|
| Strip selected images | all 5 | UI, REST `POST /sessions/:id/strip` |
| Strip every image in a session | all 5 | UI, REST |
| Resize images to target byte budget (via `sharp`) | claude, cline | UI, REST `POST /sessions/:id/resize` |
| Restore a stripped image from external base64 | all 5 | UI, REST `POST /sessions/:id/restore` |
| Mutate Cursor SQLite directly (rewrites `composerData:` / `bubbleId:` blobs) | cursor | UI, REST |

### Export

| Capability | Tools | Surfaces |
|---|---|---|
| Markdown export with rich tool details, diffs, headings | claude, cline, gemini | UI, CLI `export`, REST `GET /sessions/:id/export` |
| Plain-text export (`--format txt`) | claude | CLI |

### Security

| Capability | Tools | Surfaces |
|---|---|---|
| Scan for high/medium/low-severity secrets (API keys, bearer tokens, AWS, GitHub PATs, env files, …) | claude, cline, gemini, cursor | UI, CLI `scan`, REST `GET /sessions/:id/scan`, MCP `conclear_scan_secrets` |
| Redact matched secrets in place (replaces with `****REDACTED****`, writes backup) | claude, cline, gemini | UI Security page, REST `POST /sessions/:id/redact` |
| Rotate-this-key link mapping a finding's type → provider rotation URL (OpenAI / Anthropic, AWS IAM, GitHub tokens, GitHub SSH keys) | all scanning tools | UI Security page |
| Restore any prior version of a session file from a backup | all mutating tools | UI Backups page, REST `POST /api/backups/:name/restore` |

### Install / lifecycle

| Capability | Surfaces |
|---|---|
| Install ConClear's MCP (and Skill) into 11 AI clients | CLI `install` |
| Uninstall from any subset | CLI `uninstall` |
| Status / health check per client | CLI `doctor` |
| JSONC-safe edits for clients with comment-bearing configs (Zed) | (internal) |

See [Install into AI Clients](install.md) for the full reference.

## Emergent uses

Things that *fall out of composing primitives*, not separate commands. Agents have discovered most of these:

- **Recover a deleted file the agent had read or written.** The full content lives in the session's tool results, retrievable by line number even after the file is gone from disk.
- **Time-travel a single file across an agent run.** Multiple versions per file, ordered by line number / timestamp, let you diff version *n* vs *n−1*.
- **"When did X first/last happen?"** Cross-tool search returns timestamps + session names + roles, system-tag stripped.
- **Pull clean context from session A into session B.** `conclear_context` returns user/assistant text only, capped at 100KB — an agent in another IDE can ingest it directly.
- **Audit replay of an agent's actions.** Timeline events (`edit | read | write | bash | search | agent | image | error`) reconstruct what the agent actually did, including bash commands with exit codes.
- **Find code the agent suggested but you never committed.** Diff `parseFileHistory` results against the current git tree.
- **Triage where a leaked secret first appeared.** Loop `listSessions()` → `scanSecrets()` and sort by severity.
- **Reclaim disk space.** `imageSizeBytes` + `toolResultSizeBytes` + `hasOversizedImages` rank deletion targets; strip or resize cleans them with reversible backup.
- **Cost analysis.** `Session.usage` (Cline today) exposes tokens in/out, cache hits, total USD per task.

## Known limitations (latent capabilities)

Honest about what doesn't work yet:

- **Windsurf chats are not readable.** Cascade conversations are stored as encrypted protobuf files in `~/.codeium/windsurf/cascade/*.pb`. Reading them would require reverse-engineering Codeium's encryption. ConClear *can* still install its MCP server into Windsurf (`conclear install --windsurf`) so any Windsurf session can query *other* tools' history through ConClear.
- **Cursor file history.** Cursor stores tool calls in `toolFormerData` blobs inside `cursorDiskKV` SQLite rows. The blob shape is parseable but not yet wired into `getFileHistory`. Until that lands, file recovery works for Claude Code and Cline only.
- **Cursor redact** is intentionally deferred. Rewriting SQLite blobs while Cursor is running is risky and the cache-invalidation story is murky. Cursor sessions are read-only for the secrets pipeline — scan finds them, rotate links roll them, and the recommended cleanup is to delete the session inside Cursor itself.
- **Copilot Chat capability gain.** Read-only today; no scan / redact / export. Lower priority because Copilot's session data is the smallest of the five and rarely contains pasted credentials in the wild.
- **MCP coverage for Cursor's `suggestedCodeBlocks` and `checkpointId`.** Both fields are parsed but unused. They could surface as "code Cursor proposed that I didn't accept" and a per-bubble rewind navigator respectively.

These gaps are listed deliberately — every one is a path to a new capability with the primitives already in place.

## Add your own

If you discover a use we didn't anticipate, the smallest contribution is editing this page's **Emergent uses** section to document it. The larger one is wiring a missing primitive — see [Architecture](architecture.md) and [Adapter Pattern](adapter-pattern.md).
