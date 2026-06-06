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
- `query` (string, required) -- text to search for
- `project` (string, optional) -- filter by project name
- `limit` (number, optional) -- max results (default: 20, max: 100)

**Returns:** JSON array of matches with `sessionId`, `sessionName`, `project`, `timestamp`, `role`, `text`.

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

Get clean conversation text from a session (user and assistant messages only).

**Inputs:**
- `session` (string, required) -- session name, ID, or partial match
- `limit` (number, optional) -- return only the last N messages

**Returns:** JSON array of messages with `role`, `timestamp`, `text`. Total output is capped at 100KB.

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
