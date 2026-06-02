# Architecture

ConClear is a full-stack TypeScript application with three main components:

## Components

### Express Server (`src/server/`)

A local Express 5 server that:

- Serves the REST API on `/api/` routes.
- In production, serves the built Vite frontend as static files.
- Runs on port 3789.

### React Frontend (`src/client/`)

A React 19 single-page application built with Vite. Key components:

| Component | Purpose |
|-----------|---------|
| `SessionTable` | Session list with search and navigation |
| `PaneLayout` | Split-pane layout manager |
| `ImagePreview` | Image thumbnails and lightbox |
| `TimelineView` | Chronological event log |
| `ConversationView` | Chat message replay |
| `FilesView` | File version browser with code viewer |
| `DiskUsage` | Size visualization |
| `Toolbar` | Tab switcher and actions |
| `ContextMenu` | Right-click menu via Radix UI |
| `ResizeMenu` | Target size selector for resize operations |
| `ScanResults` | Secret scanning results display |
| `BackupManager` | View and manage backups |
| `ConfirmDialog` | Confirmation for destructive operations |
| `HelpPanel` | Keyboard shortcuts and help |
| `Toast` | Notification messages |
| `SizeIndicator` | Visual size badges |
| `HighlightText` | Search match highlighting |

### CLI (`src/cli.ts`, `src/cli-query.ts`)

Zero-dependency CLI that dispatches to query functions, the MCP server, the install lifecycle commands, or the web server. Query commands import the Claude adapter directly -- no server needed.

### MCP Server (`src/mcp-server.ts`)

MCP server using `@modelcontextprotocol/sdk`. Supports both stdio transport (default) and Streamable HTTP (`conclear mcp --http`). Registers five tools for AI agent access.

### Install lifecycle (`src/install/`)

A second adapter system, separate from the session-reading adapters, that wires ConClear into AI clients (Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Google Antigravity, Zed, Cline, Continue, Codex CLI, Kiro CLI). Each client gets its own adapter under `src/install/clients/*.ts` implementing detect/install/uninstall/status. Powers `conclear install`, `conclear uninstall`, and `conclear doctor`.

Key pieces:

| File | Purpose |
|------|---------|
| `src/install/types.ts` | `ClientAdapter` interface |
| `src/install/paths.ts` | Per-platform config and skills paths for every supported client |
| `src/install/mcp-file.ts` | Generic JSON read-merge-write for file-based clients |
| `src/install/jsonc-util.ts` | JSONC-aware variant (Zed) using `jsonc-parser` so comments/formatting survive edits |
| `src/install/skill.ts` | Copies `skill.md` → `<client-skills-dir>/conclear/SKILL.md` |
| `src/install/clients/*.ts` | One adapter per client; routes to CLI, file, JSONC, or manual path |
| `src/install/index.ts` | Orchestrates detect → install / uninstall / status across selected adapters |

All config edits create a timestamped backup under `~/.conclear/backups/`.

## Dependencies

| Package | Purpose |
|---------|---------|
| `express` | HTTP server |
| `react`, `react-dom` | Frontend UI |
| `sharp` | Image resizing |
| `highlight.js` | Syntax highlighting |
| `@modelcontextprotocol/sdk` | MCP server implementation |
| `@radix-ui/*` | UI primitives (context menu, tooltip, scroll area, separator) |
| `zod` | Schema validation (MCP tool inputs) |
| `open` | Open browser on startup |
| `jsonc-parser` | JSONC-aware edits for Zed's `settings.json` |
| `vite` | Frontend build tool |
| `tsx` | TypeScript execution for dev mode |

## Build

```bash
npm run build
```

This runs Vite to build the frontend, then `tsc` to compile the server TypeScript. Output goes to `dist/`.
