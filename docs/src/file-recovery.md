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

## Proposed background service — prototype only

A standalone [developer recorder prototype](recovery-prototype.md) now exercises capture and recovery on disposable projects. The automatic background service described below is not implemented or enabled.

The proposed recorder would preserve project files independently of agent behavior or Git commits. Capture, storage, and integrity checks would use deterministic code, without AI. Conversation integration could help locate relevant recovery points, but would not decide whether file contents are saved.

The design direction is an operating-system-managed service with automatic startup and restart, an initial project baseline, filesystem notifications for prompt capture, and periodic reconciliation to detect missed changes. Durable progress and visible last-successful-capture information would help expose interruptions. Optional hooks could request a completed checkpoint before supported agent operations or deployments.

**This design does not promise to capture every intermediate version or prevent all code loss.** A file can be written and overwritten before the recorder reads it. Reconciliation can capture the current contents, but cannot recreate an overwritten state it never observed. Restarting after downtime cannot recover changes that disappeared during that downtime. A checkpoint before a shell command also does not capture every write inside that command.

Stronger guarantees would require verified write interception or storage-level version preservation. Remote files would require coverage on the remote machine. A running service alone would not establish successful capture, and independently captured files would not necessarily form an atomic project snapshot.

Before implementation is described as providing recovery coverage, it should be tested against rapid writes, shell edits, deletion, renaming, crashes, and restarts, with byte-for-byte restoration checks. Documentation and status reporting should distinguish captured recovery points from detected gaps and unsupported locations. No background recorder or automatic recovery protection is included in the current release.
