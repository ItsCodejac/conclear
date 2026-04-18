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

Zero-dependency CLI that dispatches to query functions or launches the server. Query commands import the Claude adapter directly -- no server needed.

### MCP Server (`src/mcp-server.ts`)

Stdio-based MCP server using `@modelcontextprotocol/sdk`. Registers five tools for AI agent access.

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
| `vite` | Frontend build tool |
| `tsx` | TypeScript execution for dev mode |

## Build

```bash
npm run build
```

This runs Vite to build the frontend, then `tsc` to compile the server TypeScript. Output goes to `dist/`.
