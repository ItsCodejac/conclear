# Timeline Tab

The Timeline tab shows a chronological event log of everything that happened during a session.

## Event Types

| Type | Description |
|------|-------------|
| `user` | User message |
| `assistant` | Assistant text response |
| `edit` | File edit operation |
| `read` | File read operation |
| `write` | File write operation |
| `bash` | Shell command execution |
| `search` | Grep or glob search |
| `agent` | Subagent spawn |
| `image` | Screenshot or image shared |
| `error` | Failed operation |

## Event Details

Each event shows:

- **Type badge** -- color-coded by event type.
- **Timestamp** -- when the event occurred.
- **Summary** -- one-line description (file path, command snippet, or first line of text).
- **Detail** -- expandable area with full content: complete text, command output, diff, etc.
- **File path** -- for file operations, the path that was read/edited/written.
- **Exit code** -- for bash commands, the process exit code.
- **Duration** -- for timed operations, how long they took.

## Filtering

Filter events by type using the toolbar controls. You can show/hide specific event types to focus on what matters -- for example, show only file edits, or only bash commands.

## Search

Search within the timeline to find specific events by content.
