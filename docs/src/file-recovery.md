# File Recovery

ConClear extracts recorded file contents and edit fragments from supported AI session logs. Recovery depends on what the client recorded and what its adapter can extract; a listed version is not necessarily a complete file.

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
| `edit` | Recorded edit content, which may be only a replacement fragment |
| `write` | Recorded write content; inspect the entry before treating it as a complete file |

Not all adapters support full file history. Currently, the Claude Code adapter provides the most complete file tracking.

Inspect recovered content before using it. Shell-based edits and code suggested in messages are not systematically reconstructed. The latest recorded entry does not establish a complete, working project state.

## Independent background recovery

ConClear now includes independent local recovery in the installed package. Enroll a project in the **Recovery** page or with `conclear recovery add /absolute/project/path`. A managed observer preserves included file states independently of agent tools and Git commits. The CLI, local API, and read-only MCP expose health and captured points; the UI and CLI support pinning and verified restoration into a new directory.

See [Independent Recovery](recovery.md) for startup, storage policy, exclusions, and service management, and [engine validation](recovery-prototype.md) for dated measurements. A watcher cannot promise every intermediate version, atomic project snapshots, or recovery of bytes it never observed. Conversation extraction and independent file recording are separate evidence sources; automatic attribution between them is future work.
