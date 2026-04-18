# File Recovery

AI coding tools record every file they read, edit, or write during a session. ConClear indexes this data so you can recover previous versions of any file.

## From the Web UI

1. Select a session and open the **Files** tab.
2. Browse the list of files touched during the session.
3. Click a file to see all its versions.
4. Click a version to open it in the syntax-highlighted code viewer.
5. Use the copy button to copy the content to your clipboard.

## From the CLI

```bash
# Find all versions of a file across all sessions
conclear files "api.ts"

# Find versions in a specific session
conclear files "api.ts" --session my-session

# Get the latest version content
conclear files "api.ts" --session my-session --latest

# Pipe directly to a file for recovery
conclear files "api.ts" --session my-session --latest > recovered-api.ts
```

## From the MCP Server

Use the `conclear_file_content` tool:

```json
{
  "session": "my-session",
  "file_path": "api.ts",
  "version": 0
}
```

The `version` parameter is 0-indexed. Omit it to get the latest version.

## What Gets Tracked

| Operation | Description |
|-----------|-------------|
| `read` | File was read by the AI tool (content at time of read) |
| `edit` | File was modified (content after edit) |
| `write` | New file was created (full content) |

Not all adapters support full file history. Currently, the Claude Code adapter provides the most complete file tracking.
