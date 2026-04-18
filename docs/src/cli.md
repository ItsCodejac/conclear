# CLI

ConClear includes a command-line interface for querying session history without starting the web server. All CLI commands read session files directly from disk.

```bash
conclear --help
```

## Command Categories

### Query Commands (no server needed)

These commands run standalone -- they read session data directly:

- `search` -- full-text search across sessions
- `files` -- find file versions from past sessions
- `sessions` -- list all indexed sessions
- `summary` -- get a session overview
- `context` -- dump clean conversation text
- `export` -- export session as markdown
- `scan` -- scan for potential secrets

### MCP Server

- `mcp` -- start the MCP server (stdio transport)

### UI Launcher

- `conclear` (no arguments) -- start the web UI
- `conclear --ui` -- start the web UI

## Global Flags

| Flag | Description |
|------|-------------|
| `--json` | Output structured JSON (works on all query commands) |
| `--help`, `-h` | Show help |

## Session Resolution

All commands that take a session identifier support flexible matching:

1. Exact session ID (UUID)
2. Partial ID prefix
3. Exact session name (case-insensitive)
4. Partial name match
5. Preview text match

When multiple sessions match, the most recently active one is returned.
