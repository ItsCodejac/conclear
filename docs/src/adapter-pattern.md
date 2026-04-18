# Adapter Pattern

ConClear uses an adapter pattern to support multiple AI coding tools. Each tool gets its own adapter that implements a common interface.

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
