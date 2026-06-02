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

Run a single command to install the MCP server (and Skill, where supported) into every AI client you have installed:

```bash
conclear install
```

This auto-detects Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Google Antigravity, Zed, Cline, Codex CLI, and Kiro CLI. To see what's installed where:

```bash
conclear doctor
```

To start the server manually (or for clients that aren't auto-installable):

```bash
conclear mcp                  # stdio (default)
conclear mcp --http            # Streamable HTTP on :7331
```

If you'd rather wire ConClear up by hand, the canonical MCP entry is:

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

See [Install into AI Clients](install.md) for the full reference.
