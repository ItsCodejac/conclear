# MCP Server

ConClear runs as an MCP (Model Context Protocol) server so AI agents can query your session history through tool use. It uses stdio transport, the standard for Claude Code MCP servers.

## Starting the Server

```bash
conclear mcp
```

The server runs until the process is killed. It logs to stderr so it doesn't interfere with the MCP stdio protocol on stdout.

## Configuration

Add ConClear to your Claude Code MCP settings (in `~/.claude/settings.json` or project-level `.claude/settings.json`):

```json
{
  "mcpServers": {
    "conclear": {
      "command": "npx",
      "args": ["conclear", "mcp"]
    }
  }
}
```

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

## Tool Annotations

All MCP tools are annotated as read-only, non-destructive, and idempotent. They do not modify session data.
