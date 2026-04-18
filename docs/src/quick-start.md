# Quick Start

## Launch the Web UI

```bash
conclear
```

This starts a local server on port 3789 and opens your browser to `http://localhost:3789`. ConClear scans all detected AI tool data directories and displays your sessions.

## Try the CLI

List your recent sessions:

```bash
conclear sessions
```

Search across all sessions:

```bash
conclear search "auth middleware"
```

Get a session summary:

```bash
conclear summary my-session-name
```

All CLI commands work without the web server -- they read session files directly.

## Set up the MCP server

Add ConClear to your Claude Code MCP configuration so AI agents can query your session history:

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
