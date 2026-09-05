# Architecture

ConClear is a full-stack TypeScript application with shared session-reading adapters and several entry points:

## Components

### Express Server (`src/server/`)

A local Express 5 server that:

- Serves the REST API on `/api/` routes.
- In production, serves the built Vite frontend as static files.
- Runs on port 3789.

### React Frontend (`src/client/`)

A React 19 single-page application built with Vite. `App.tsx` selects pages and coordinates session loading, scan results, navigation, and toasts.

| Area | Purpose |
|------|---------|
| `pages/Overview.tsx` | Reclaim overview and update notifications |
| `pages/Sessions.tsx`, `pages/sessions/` | Session browser, detail, images, chat, timeline, files, and security tabs |
| `pages/Security.tsx`, `hooks/useScanCache.ts` | Shared scan results and redaction workflow |
| `pages/Connect.tsx`, `hooks/useInstall.ts` | Client installation status and actions |
| `pages/Backups.tsx` | Backup management |
| `commands/CommandPalette.tsx` | Session and message search |
| `hooks/useSessions.ts`, `hooks/useSessionDetail.ts` | Session list caching and detail requests |

`src/client.legacy/` contains the previous frontend and is not the active application. Admin/Teams pages are also present but are not imported by the free build.

### CLI (`src/cli.ts`, `src/cli-query.ts`)

The CLI dispatches to query functions, the MCP server, installation commands, or the web server. Query handlers live in `src/cli-query/` and use the shared multi-tool adapter registry without starting a server.

### MCP Server (`src/mcp-server.ts`)

MCP server using `@modelcontextprotocol/sdk`. Supports both stdio transport (default) and Streamable HTTP (`conclear mcp --http`). Registers seven read-only tools for AI agent access. Search and context return structured retrieval envelopes; see [MCP Server](mcp-server.md) for their contracts.

### Shared retrieval (`src/server/context.ts`, `src/server/search.ts`)

`src/server/adapters/registry.ts` owns the five session adapters used by REST, CLI, and MCP. Search and bounded context both request `getConversation(id, { fullText: true })`, then use the same message-reference construction. The UI conversation route keeps its preview behavior.

- `searchConversations()` inspects listed sessions and returns `{ matches, coverage }`, reporting omitted matches and failed sources. The web search wrapper retains its array response.
- `contextPage()` returns `{ messages, page, ... }`, applies a shared text budget, and produces cursors that resume within long messages.
- References are scoped to the tool/session and derived from message identity and text. Cursors also include a parsed-conversation revision, preventing silent continuation into changed history.

The retrieval layer does not persist another copy of the conversation or generate summaries. Search reads current source conversations on each request; metadata caches are separate from full-text retrieval. It does not implement automatic correction detection or active-conversation checkpoints.

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
