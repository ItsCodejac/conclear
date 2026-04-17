# ConClear

Your AI coding sessions are full of screenshots you'll never look at again. ConClear finds them, shows them to you, and lets you fix the problem before Claude tells you it can't handle your images.

## The problem

Every time you paste a screenshot into Claude Code, Cursor, or any AI coding tool, that image data stays in your session file forever. Sessions grow to 50MB, 100MB, or more. Eventually you get this:

```
An image in the conversation exceeds the dimension limit for many-image requests (2000px).
Run /compact to remove old images from context, or start a new session.
```

ConClear gives you a better option than `/compact` or starting over.

## Install

```bash
npm install -g conclear
```

Or run directly:

```bash
npx conclear
```

## What you get

**A visual session browser** that scans all your AI tool data and shows you exactly what's taking space.

<!-- Screenshot: landing page with session list and disk usage overview -->
<!-- docs/screenshots/landing.png -->

**Image preview and cleanup** — see every screenshot stored in a session. Strip them (replace with a tiny placeholder), resize them (shrink to a target file size), or leave them alone. Your choice, per-image or in bulk.

<!-- Screenshot: image panel with thumbnails and strip/resize buttons -->
<!-- docs/screenshots/images.png -->

**File version history** — every file your AI tool read, edited, or wrote is tracked with full content. Browse versions, view with syntax highlighting, compare diffs, copy code. This is your safety net when git isn't enough.

<!-- Screenshot: files tab with syntax-highlighted code viewer -->
<!-- docs/screenshots/files.png -->

**Conversation replay** — read through past sessions with clean formatting. Search for specific discussions. Filter by user or assistant messages. Export as markdown.

<!-- Screenshot: chat view with conversation -->
<!-- docs/screenshots/chat.png -->

**Timeline** — event log of everything that happened: edits, bash commands, file reads, errors. Filter by type, search by content.

<!-- Screenshot: timeline view with event types -->
<!-- docs/screenshots/timeline.png -->

## Supported tools

| Tool | Format | Status |
|------|--------|--------|
| Claude Code | JSONL | Full support |
| Gemini CLI | JSON | Full support |
| Cursor | SQLite | Full support |
| Cline / Roo Code | JSON | Full support |
| GitHub Copilot Chat | JSON | Full support |

ConClear auto-detects which tools you have installed and scans their session directories. No configuration needed.

## CLI

Query your session history from the terminal — no server needed. Useful for quick lookups and for AI agents that need context from past sessions.

```bash
# List recent sessions
conclear sessions

# Search across all conversations
conclear search "auth middleware" --project myapp

# Find file versions
conclear files "api.ts" --latest

# Get a session summary
conclear summary veesty-rebuild-plan

# Dump conversation for piping
conclear context my-session | head -100

# Export as markdown
conclear export my-session --output session.md
```

All commands support `--json` for structured output.

## MCP server

ConClear runs as an MCP server so AI agents can query your session history through tool use:

```bash
conclear mcp
```

Configure in your Claude Code settings:

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

Tools available: `conclear_search`, `conclear_sessions`, `conclear_summary`, `conclear_file_content`, `conclear_context`.

## Problem detection

ConClear automatically flags sessions that would trigger the 2000px dimension limit warning — before it happens. Look for the amber warning icon in the session list.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus search |
| `Up` / `Down` | Navigate sessions |
| `Enter` | Select session |
| `Escape` | Close panel / lightbox / clear search |
| `Cmd+R` | Refresh |
| Double-click | Expand session to full view |
| Right-click | Context menu (strip, resize, copy resume command) |

## How it works

ConClear runs a local server that reads session files directly from disk. No data leaves your machine. The React frontend presents the data and sends operation requests back to the server.

Before any destructive operation (strip, resize), a timestamped backup is created in `~/.conclear/backups/`. You can manage backups from the UI.

The architecture uses an adapter pattern — each AI tool gets its own parser. Adding support for a new tool means writing one adapter file.

## Building from source

```bash
git clone https://github.com/ItsCodejac/conclear
cd conclear
npm install
npm run dev        # Development (Vite + Express)
npm run build      # Production build
npm start          # Run production server
```

## License

MIT
