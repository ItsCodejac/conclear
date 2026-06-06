# ConClear

[![npm version](https://img.shields.io/npm/v/conclear.svg)](https://www.npmjs.com/package/conclear)
[![npm downloads](https://img.shields.io/npm/dm/conclear.svg)](https://www.npmjs.com/package/conclear)
[![CI](https://github.com/ItsCodejac/conclear/actions/workflows/ci.yml/badge.svg)](https://github.com/ItsCodejac/conclear/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/conclear.svg)](https://github.com/ItsCodejac/conclear/blob/main/LICENSE)

**A local utility for managing AI coding session data — disk space, leaked secrets, lost files, and conversation history — across every major AI coding tool.**

ConClear reads your session files directly from disk, gives you a unified view of what's in them, and hands you the controls to clean up, recover, or hand them to your agents through MCP. Nothing ever leaves your machine.

```bash
npm install -g conclear
conclear
```

Or run without installing:

```bash
npx conclear
```

## What it does

### Reclaim disk space

Every screenshot you paste into a session sits in that file forever. ConClear finds them, shows you each one, and lets you strip them (replace with a placeholder), resize them (shrink to a target size), or leave them alone — per-image or in bulk. Sessions go from 100 MB+ back to a few MB.

### Find and redact leaked credentials

Pasted API keys, AWS keys, GitHub tokens, `.env` dumps, bearer tokens, database URLs — anything that ends up in a session file is stored in plaintext. ConClear scans for them, shows you where they are, redacts them with one click (every redact writes a backup first), and links to the right rotation page so you can roll the credential.

### Recover lost work

Every file your agent read, wrote, or edited during a session is preserved with full content and version history. Open the session, browse versions, view with syntax highlighting, copy the code back out.

### Bridge sessions to your agents (MCP)

ConClear ships with an MCP server. Install it into one click into Claude Code, Cursor, Windsurf, Antigravity, VS Code, Zed, Cline, Codex CLI, Continue, Kiro CLI, or Claude Desktop, and your agents can search, summarize, list files, scan secrets, and pull conversation context from any past session — without leaving the chat.

### Browse and replay

Visual session browser, full conversation viewer with role filters, timeline of every event (edits, bash commands, tool calls, errors), file diff viewer, markdown export. Search across everything with `⌘K`.

## Supported tools

ConClear auto-detects which tools are installed and reads their session data — no configuration. The capability table reflects what each adapter actually implements today; nothing here is aspirational.

| Tool | List & read | Images | File history | Scan secrets | Redact | Export |
|---|---|---|---|---|---|---|
| **Claude Code** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Cline / Roo Code** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Gemini CLI** | ✓ | ✓ | — | ✓ | ✓ | ✓ |
| **Cursor** | ✓ | ✓ | — | ✓ | — | — |
| **GitHub Copilot Chat** | ✓ | — | — | — | — | — |

Cursor redact is intentionally deferred — rewriting live SQLite blobs while Cursor is running is risky. Use the rotate links to roll any leaked credentials and delete the session inside Cursor.

## CLI

Query session history from the terminal — no server, no UI needed. Useful for fast lookups and for agents that need session context.

```bash
conclear sessions                          # list recent sessions
conclear search "auth middleware"          # full-text across every session
conclear search "X" --project myapp        # scope to a project
conclear files "api.ts" --latest           # find file versions touched in any session
conclear summary <session>                 # session digest
conclear context <session>                 # clean user+assistant conversation text
conclear scan <session>                    # scan for leaked credentials
conclear export <session>                  # markdown
```

All commands take `--json` for structured output. Session lookup accepts ID prefix, exact name, or partial match.

## MCP server

`conclear mcp` runs the Model Context Protocol server. Agents see the following tools:

| Tool | What it does |
|---|---|
| `conclear_search` | Full-text search across every session |
| `conclear_sessions` | List sessions, most recently active first |
| `conclear_summary` | Session digest — files touched + key user messages |
| `conclear_context` | Clean user / assistant conversation text |
| `conclear_files` | List every file a session touched, with version counts |
| `conclear_file_content` | Fetch a specific file version from a session |
| `conclear_scan_secrets` | Scan a session for leaked API keys / tokens / .env dumps |

Transports:

```bash
conclear mcp                  # stdio (default — what every client below uses)
conclear mcp --http           # Streamable HTTP on :7331
conclear mcp --http --port N  # custom port
```

## Install into AI clients

`conclear install` wires the MCP server (and skill, where supported) into every AI client it can find — no manual config edits:

```bash
conclear install              # detect every client and install
conclear install --all        # install everywhere, even undetected
conclear install --cursor --claude-code   # specific clients
conclear install --no-skill   # MCP only
conclear uninstall            # same flags
conclear doctor               # show per-client install status
```

| Client | MCP | Skill | Notes |
|---|---|---|---|
| Claude Code | ✓ | ✓ | uses `claude mcp add` |
| Claude Desktop | ✓ | — | restart required |
| Cursor | ✓ | ✓ | skills since v2.2 |
| Windsurf | ✓ | — | ~100-tool cap surfaced in `doctor` |
| VS Code (Copilot) | ✓ | — | uses `code --add-mcp` |
| Google Antigravity | ✓ | ✓ | |
| Zed | ✓ | — | comments preserved (JSONC merge) |
| Cline | ✓ | — | |
| Codex CLI | ✓ | — | uses `codex mcp add` |
| Kiro CLI | ✓ | — | |
| Continue | manual | — | prints YAML snippet to paste |

Every edit ConClear makes is backed up to `~/.conclear/backups/` first; uninstall restores them.

If you'd rather wire it up by hand, the canonical entry is:

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

## Security loop

When ConClear finds a leaked credential it does three things, in order:

1. **Surface it** in the Security page with the credential redacted (first 4 / last 4 chars only) so you can see *what* leaked without re-exposing it.
2. **Redact it on disk** when you click — every redact is backed up first, so it's recoverable from the Backups page if you ever need it.
3. **Link to the rotation page** for the provider (OpenAI, Anthropic, AWS IAM, GitHub tokens, GitHub SSH keys) so you actually roll the credential — redacting the file doesn't invalidate the key on the provider side.

The Backups page lets you restore any prior version of any session file in one click. Nothing ConClear does is irreversible.

## Privacy

ConClear runs entirely on your machine. There is no cloud, no telemetry, no account, no upload. Session data is read from local disk, displayed in a local web UI on `localhost:3789`, and mutated only in place (with backups). The MCP server runs locally and is spawned on demand by your AI client — there's no persistent process listening.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Open search palette |
| `⌘R` / `Ctrl+R` | Rescan sessions |
| `Esc` | Close panel / palette |

## How it works

ConClear runs a local Express server that reads session files via per-tool adapters (`src/server/adapters/<tool>/`) and a React + Vite frontend that presents the data. The adapter pattern means adding support for a new tool is a single file.

Every destructive operation (strip, resize, redact) writes a timestamped backup to `~/.conclear/backups/` first, with a sidecar metadata file recording the original path so the Backups page can restore it in one click. Backup integrity is verified by size after copy.

## Building from source

```bash
git clone https://github.com/ItsCodejac/conclear
cd conclear
npm install
npm run dev        # Vite + Express, hot reload
npm run build      # production
npm start          # run production build
npm test           # 38 tests
```

## Demo mode

If you want to try ConClear without your real session data — or want to use it for screenshots and demos:

```bash
conclear --demo
```

This reroots every adapter at the bundled fixtures (`demo-fixtures/`) — small, synthetic but realistic sessions across three formats — so the app launches clean.

## Roadmap

Free CLI + web UI + MCP server stays free. The next major release will add an optional desktop app with first-class AI assistance (BYOK Claude / OpenAI / local models), and a Teams tier that syncs only *metadata* (leak findings, install state, usage totals) — never conversation content — for organizations that want visibility without surveillance.

## License

MIT
