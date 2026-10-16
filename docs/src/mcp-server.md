# MCP Server

ConClear runs as an MCP (Model Context Protocol) server so AI agents can query your session history through tool use. It uses stdio transport, the standard for Claude Code MCP servers.

## Starting the Server

```bash
conclear mcp                  # stdio transport (default)
conclear mcp --http            # Streamable HTTP on :7331
conclear mcp --http --port 8080
```

The server runs until the process is killed. In stdio mode it logs to stderr so it doesn't interfere with the MCP stdio protocol on stdout.

SSE transport is not supported — it has been deprecated upstream in favor of Streamable HTTP.

## Configuration

The recommended way to wire ConClear up to your AI client is `conclear install` — it auto-detects 10+ clients and handles per-client schema quirks. See [Install into AI Clients](install.md).

If you'd rather edit config by hand, the canonical MCP entry is:

```json
{
  "mcpServers": {
    "conclear": {
      "command": "conclear",
      "args": ["mcp"]
    }
  }
}
```

VS Code uses `servers` (not `mcpServers`) and requires `"type": "stdio"`. Zed nests under `context_servers` and requires `"source": "custom"`.

## Available Tools

### conclear_search

Search messages across all sessions by text query.

**Inputs:**
- `query` (string, required) -- text to search for, 1–500 characters
- `project` (string, optional) -- filter by project name
- `limit` (number, optional) -- max results (default: 20, max: 100)

**Returns:** `{ matches, coverage }`. Each match includes `sessionId`, `tool`, `messageRef`, `messageIndex`, `matchOffset`, `project`, `timestamp` (when recorded), `role`, and a compact `text` snippet. `coverage` reports searched sessions, matching messages, omitted matches, and failed sources. Narrow the query/project or raise the limit when matches were omitted. Search covers parsed user/assistant text, excluding tool calls, tool results, system messages, and images.

Use `messageRef` as `around` in `conclear_context`, with the match's `sessionId` and `tool`. Search results are recorded evidence, not verified conclusions.

### conclear_sessions

List available sessions, sorted by most recently active.

**Inputs:**
- `project` (string, optional) -- filter by project name
- `limit` (number, optional) -- max sessions (default: 20, max: 100)

**Returns:** JSON array of sessions with `id`, `name`, `preview`, `project`, `lastActive`, `messageCount`, `imageCount`, `size`.

### conclear_summary

Get a summary of a specific session including files touched and key user messages.

**Inputs:**
- `session` (string, required) -- session name, ID, or partial match

**Returns:** JSON object with session metadata, files touched, and key user messages.

### conclear_file_content

Get a specific file version from a session.

**Inputs:**
- `session` (string, required) -- session name, ID, or partial match
- `file_path` (string, required) -- file path or partial path to find
- `version` (number, optional) -- version index (0-based, defaults to latest)

**Returns:** JSON object with file path, version info, and content. If multiple files match, lists matches instead.

### conclear_context

Retrieve bounded original conversation text. With no navigation options, returns up to the last 20 messages, sharing a 12,000-character text budget.

**Inputs:**

- `session` (required): session name, ID, or partial match.
- `tool`: `claude`, `cline`, `gemini`, `cursor`, or `copilot`; use the value from search to disambiguate IDs.
- `around`: exact `messageRef` from search or a previous context page.
- `before` / `after`: surrounding messages (defaults 3 / 6, each 0–20); require `around`.
- `offset`: start inside the referenced message; requires `around` and `before: 0`. Use a search hit's `matchOffset` to reach a match deep in a long message.
- `cursor`: `nextCursor` or `previousCursor` from a previous response; cannot be combined with `around`, `before`, `after`, or `offset`.
- `limit`: maximum messages per page (default 20, maximum 50).
- `maxChars`: shared text budget (default 12,000; range 256–50,000), excluding JSON metadata. Character offsets use JavaScript UTF-16 units, not tokens or bytes.

**Returns:** an object with `sessionId`, `tool`, `revision`, `scope`, `messages`, and `page`. Each message has a `messageRef`, index, role, timestamp where available, text, character offsets, original character count, and `partial` flag. JSON is always serialized intact; long messages are split into recoverable fragments.

`page.complete` means this response contains the entire parsed conversation text. `windowComplete` means the requested window was delivered; it does **not** mean the conversation is complete. `hasEarlier`, `hasLater`, and continuation cursors identify omitted history. `anchorIncluded` reports whether the budget reached the requested message. If not, reopen it with `before: 0`.

`nextCursor` resumes at the first unread character, including within a long message. It finishes an interrupted window before continuing into later history. `previousCursor` opens earlier messages; if they need multiple pages, follow their `nextCursor` to finish them. `omittedPrefixChars` identifies text before a fragment; reopen that message with `around`, `before: 0`, `after: 0` to retrieve its prefix.

References are scoped to tool and session and include message identity and a content hash. They survive appended messages, but an edited/redacted message (or a changed adapter-generated identity) requires a new search. Cursors are bound to the parsed conversation revision and must be restarted if that conversation changes. Missing or changed references return an error rather than silently selecting another message.

Example workflow:

```json
{"session":"SESSION_ID","tool":"claude","around":"MESSAGE_REF","before":1,"after":3,"maxChars":6000}
```

Then pass the returned `page.nextCursor` as `cursor`, keeping the same session/tool. Retrieve only as much later evidence as the question needs. Dates record when something was said, not whether it is still correct.

**Compatibility:** `conclear_context` previously returned an array; it now returns a page object. `conclear_search` previously returned an array; it now returns `{ matches, coverage }`. Update consumers to read `.messages` and `.matches`. The web UI's existing `/api/search` array and `/api/sessions/:id/conversation` preview responses remain unchanged. The bounded REST endpoint is `GET /api/sessions/:id/context`, with the same options as query parameters.

### conclear_files

List every file the agent read, edited, or wrote in a session, with version counts per file. Use this before `conclear_file_content` when you don't know the exact path — lets you pick the file you want by name, then fetch its content.

**Inputs:**
- `session` (string, required) -- session name, ID, or partial match

**Returns:** JSON array of `{ filePath, versionCount, latestOperation, latestTimestamp }`. Adapters that don't support file history (Cursor, Gemini, Copilot) return a descriptive error.

### conclear_scan_secrets

Scan a session for leaked API keys, tokens, AWS credentials, GitHub PATs, .env dumps, and other secrets. Matched values are returned with display redaction (first 4 / last 4 chars) so the agent can describe what leaked without re-exposing it.

**Inputs:**
- `session` (string, required) -- session name, ID, or partial match

**Returns:** JSON array of findings — `{ type, severity, pattern, context, lineNumber, timestamp }`. Empty array if nothing matched. Adapters that don't support scanning (Copilot today) return a descriptive error.

## Tool Annotations

All MCP tools are annotated as read-only, non-destructive, and idempotent. They do not modify session data. Redact and image-mutation operations are intentionally **not** exposed via MCP — destructive operations always go through the web UI for human confirmation.

## conclear_recovery

Read-only independent recovery health and captured points. With no `projectId`, returns observer liveness, heartbeat and enrolled projects with capture state, last-success timestamps, errors, quotas, and exclusions. With a project id from that result, returns `{ snapshots, total, nextOffset }`; `limit` defaults to 50 (1–200), `offset` defaults to 0. The tool does not enroll, start, pin, expire, or restore. Use explicit CLI/UI actions for changes. Recorded bytes and pin reasons do not certify working code. See [Independent Recovery](recovery.md).
