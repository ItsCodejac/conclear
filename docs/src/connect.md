# Connect

The Connect page is the visual surface for `conclear install` / `uninstall` / `doctor`. It lists every supported AI client, shows install state, and lets you toggle MCP and Skill installs without touching the terminal.

## What's on it

**MCP server panel** — explains that the MCP server is *spawned on demand* by each installed client (no persistent process), shows the available transports (stdio + Streamable HTTP), and lists every tool agents get access to:

- `conclear_search`
- `conclear_sessions`
- `conclear_summary`
- `conclear_context`
- `conclear_files`
- `conclear_file_content`
- `conclear_scan_secrets`

A **Manual config** affordance copies the canonical JSON entry into your clipboard if you want to wire up a client by hand.

**Client cards** — one per supported client:

- Detection state (detected / not installed)
- Install method tag (CLI, file, deeplink, manual)
- MCP toggle (busy state while installing)
- Skill toggle (for clients that support Skills — Claude Code, Cursor v2.2+, Antigravity)
- Per-client notes (e.g., Windsurf's tool-count cap, Continue's manual paste)

**Install into N detected** — bulk button at the top. Wires up every client ConClear detected in one pass.

## Manual-install modal

A few clients (currently Continue, which is YAML) can't be auto-edited safely. For these, the install action opens a modal with the exact snippet to paste — Copy button included.

## Honest framing

The MCP chip in the titlebar used to say "running" with a live dot, which was wrong — there is no persistent ConClear MCP process. The chip and the Connect panel now reflect that: stdio MCP is spawned by each client when it needs to call a tool.

## Pairs with

- [Install into AI Clients](install.md) — CLI reference for the same operations
- [MCP Server](mcp-server.md) — what the MCP surface actually does
