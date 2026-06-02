# Adapter Pattern

ConClear uses two parallel adapter systems for two different purposes:

1. **Session-reading adapters** (`src/server/adapters/`) — parse session data from each AI coding tool. The rest of this page describes these.
2. **Client-install adapters** (`src/install/clients/`) — install ConClear's MCP server (and Skill) into each AI client. Covered briefly at the bottom of this page; full reference in [Install into AI Clients](install.md).

## Session-reading adapters

These let ConClear read session data from multiple AI coding tools. Each tool gets its own adapter that implements a common interface.

## The Adapter Interface

Every adapter must implement the `Adapter` interface defined in `src/server/adapters/types.ts`:

```typescript
interface Adapter {
  name: string;
  detect(): Promise<boolean>;
  listSessions(): Promise<Session[]>;
  getSessionDetail(sessionId: string): Promise<SessionDetail>;
  getImageData(sessionId: string, imageId: string): Promise<ImageData>;
  stripImages(sessionId: string, imageIds: string[]): Promise<{ backupPath: string; bytesReclaimed: number }>;
  stripAllImages(sessionId: string): Promise<{ backupPath: string; bytesReclaimed: number }>;
  restoreImage(sessionId: string, imageId: string, base64: string, mediaType: string): Promise<void>;
}
```

## Adapter Responsibilities

Each adapter handles:

1. **Detection** -- check if the tool's data directory exists.
2. **Session listing** -- scan the data directory and parse session metadata.
3. **Session detail** -- parse a specific session for full metadata including image inventory.
4. **Image operations** -- extract, strip, resize, and restore images in the tool's native format.
5. **Conversation parsing** -- extract chat messages for the conversation view.
6. **File history** -- extract file read/edit/write events (where supported).

## Existing Adapters

| Adapter | File | Format |
|---------|------|--------|
| `ClaudeAdapter` | `src/server/adapters/claude/` | JSONL line-by-line parsing |
| `GeminiAdapter` | `src/server/adapters/gemini/` | JSON document parsing |
| `CursorAdapter` | `src/server/adapters/cursor/` | SQLite database queries |
| `ClineAdapter` | `src/server/adapters/cline/` | JSON task directory parsing |
| `CopilotAdapter` | `src/server/adapters/copilot/` | JSON workspace storage parsing |

Each adapter directory contains:

- `index.ts` -- the adapter class implementing the `Adapter` interface.
- `parser.ts` -- format-specific parsing logic.

## Adding a New Adapter

To add support for a new AI coding tool:

1. Create a new directory under `src/server/adapters/<tool-name>/`.
2. Create `parser.ts` with format-specific parsing functions.
3. Create `index.ts` with a class implementing the `Adapter` interface.
4. Register the adapter in `src/server/routes/sessions.ts` by adding it to the `adapters` array.

The router iterates through all adapters for each request. If an adapter's `detect()` returns `true`, it participates in the session listing and can handle session-specific requests.

## Caching

Adapters use mtime-based caching. Each session file's modification time is tracked, and only files that have changed since the last scan are re-parsed. This makes repeated scans fast even with hundreds of sessions.

## Backup Strategy

All adapters create backups in `~/.conclear/backups/` before modifying session data. Backup filenames include the tool name and a timestamp for identification. Backup integrity is verified by comparing file sizes after the copy.

## Client-install adapters

A separate adapter system under `src/install/clients/` handles installing ConClear's MCP server (and Skill, where supported) into AI clients. These adapters are independent from the session-reading adapters above — they touch *the client's* config, not session data.

The `ClientAdapter` interface lives in `src/install/types.ts`:

```typescript
interface ClientAdapter {
  id: string;                              // e.g. "cursor"
  displayName: string;                     // e.g. "Cursor"
  method: 'cli' | 'file' | 'deeplink' | 'manual';
  supportsSkill: boolean;
  platforms?: NodeJS.Platform[];
  detect(): Promise<boolean>;
  installMcp(): Promise<InstallResult>;
  uninstallMcp(): Promise<InstallResult>;
  installSkill?(): Promise<InstallResult>;
  uninstallSkill?(): Promise<InstallResult>;
  status(): Promise<ClientStatus>;
}
```

Adapters route MCP install through one of:

- a client-provided CLI (`claude mcp add`, `code --add-mcp`, `codex mcp add`)
- a direct JSON file merge (`src/install/mcp-file.ts`)
- a JSONC-aware file merge that preserves comments (`src/install/jsonc-util.ts`, used for Zed)
- a manual snippet printed to the user (Continue, until a YAML parser is worth the dep)

Skill install (where the client has a skills system) is a simple copy of the bundled `skill.md` into `<client-skills-dir>/conclear/SKILL.md`.

Supported clients (Jun 2026): Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Google Antigravity, Zed, Cline, Continue (manual), Codex CLI, Kiro CLI.

Adding a new client = one file under `src/install/clients/` plus a registry entry in `src/install/adapters.ts`. See [Install into AI Clients](install.md) for the user-facing reference.
