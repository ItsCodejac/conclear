# ConClear

A local web UI for inspecting and cleaning up AI coding assistant session data.

## What it does

AI coding tools like Claude Code, Cursor, Gemini CLI, Copilot, and Cline store conversation sessions that accumulate screenshots, image pastes, and other binary data over time. These files can grow to hundreds of megabytes. ConClear gives you a visual interface to find the heaviest sessions, preview their images, and strip or resize them to reclaim disk space -- without losing the conversation text.

## Installation

```
npm install -g conclear
```

Or run without installing:

```
npx conclear
```

## Quick start

```
conclear
```

This starts a local web UI and opens it in your browser. The app will scan for sessions automatically.

For development:

```
npm install
npm run dev
```

## CLI commands

ConClear includes query commands that work without launching the web UI:

```
conclear search <query> [--project <name>] [--limit <n>] [--json]
  Search across all sessions for matching messages

conclear files <path-pattern> [--session <name-or-id>] [--latest] [--json]
  Find file versions matching a path pattern (e.g. "api.ts", "src/server/*")

conclear sessions [--project <name>] [--limit <n>] [--json]
  List sessions, most recent first

conclear summary <session-name-or-id> [--json]
  Quick summary of a session

conclear context <session-name-or-id> [--json]
  Dump full conversation as clean text (user/assistant only)

conclear export <session-name-or-id> [--output <file>] [--format md|txt]
  Export session as a clean markdown document
```

All commands support `--json` for structured output.

## Features

**Session management**
- Auto-discovers sessions from all supported tools
- Groups sessions by project with collapsible headers
- Search/filter across session names, projects, and IDs
- Sortable columns (name, project, last active, size, image count)
- Context menus on session rows (copy resume command, copy ID, copy file path)
- Disk usage overview with per-project breakdown and top offenders chart

**Image operations**
- Strip: replaces image data with a 1px placeholder, freeing the space
- Resize: re-encodes images to a target file size (50KB, 100KB, 200KB, 500KB)
- Recover: restores stripped images from an in-memory cache (available until you navigate away)
- Bulk operations: strip all, resize all, or act on a multi-selection
- Automatic backups before every destructive operation

**Views**
- Images: thumbnail grid with inline preview, expanded view, and fullscreen lightbox
- Timeline: chronological event log (user messages, tool calls, edits, bash commands)
- Chat: rendered conversation with user/assistant message bubbles
- Disk usage: aggregate stats shown when no session is selected

**UX**
- Keyboard navigation through session list
- Context menus on both session rows and individual images
- Multi-select with checkboxes for batch operations
- Confirmation dialogs for bulk destructive actions
- Toast notifications for operation results
- Resizable split pane layout
- Double-click to expand a session to full-width detail view

## Keyboard shortcuts

| Key | Action |
|---|---|
| `/` | Focus the search/filter input |
| `Arrow Up / Down` | Navigate session list |
| `Enter` | Select the focused session |
| `Escape` | Close expanded view, lightbox, or clear search |
| `Cmd+R` / `Ctrl+R` | Refresh session list |

## Supported tools

- **Claude Code** -- JSONL session files from `~/.claude/projects/`
- **Cursor** -- SQLite conversation database
- **Gemini CLI** -- Gemini CLI session files
- **Cline** -- Cline/Continue session data
- **GitHub Copilot** -- Copilot Chat session data

## MCP server

MCP server available for AI agent integration.

## How it works

ConClear runs a local Express server that reads session files directly from disk. It parses them to extract metadata, image references, message counts, and file sizes. The React frontend presents this data and sends operation requests (strip, resize, restore) back to the server, which modifies the session files in place.

All processing happens locally. No data is sent anywhere. Backups of original files are stored in `~/.conclear/backups/` before any destructive operation.

The architecture uses an adapter pattern -- each AI tool gets an adapter that knows how to find, parse, and modify its session format. Adding support for a new tool means writing a new adapter.

## Building

```
npm run build          # Build client (Vite) and server (TypeScript)
npm start              # Run production server (opens browser automatically)
```

The built output goes to `dist/`. The package exposes a `conclear` CLI binary.

## License

MIT -- see [LICENSE](./LICENSE) for details.
