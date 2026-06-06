# Cursor

## Data Format

Cursor stores conversation data in a SQLite database (`state.vscdb`) within its application data directory.

## Data Location

```
# macOS
~/Library/Application Support/Cursor/User/globalStorage/state.vscdb

# Windows
%APPDATA%/Cursor/User/globalStorage/state.vscdb

# Linux
~/.config/Cursor/User/globalStorage/state.vscdb
```

## Features Supported

- Session listing from database records
- Image preview, strip, and restore
- Conversation replay (including structured tool calls — `toolFormerData.name` + `rawArgs` + `result`)
- SQLite-aware full-text search (`searchMessages`) via the cursor adapter's per-bubble query rather than the line-based default
- **Secret scanning** — walks every bubble's text + `toolFormerData.rawArgs` + `result` against the same pattern table the other adapters use
- Backup of the database file before any mutation

## Not yet

- **Redact** is intentionally not implemented. Rewriting blobs in a live SQLite database while Cursor is running is risky, and Cursor's caching layer makes the invalidation story murky. Use the Security page's rotate links to roll the credential at the provider, and delete the affected session inside Cursor itself if you want the data gone.
- **File history** — Cursor stores tool calls in `toolFormerData` blobs; the shape is parseable but not yet wired through `getFileHistory`.

## Notes

Since Cursor uses a single SQLite database rather than individual session files, backups copy the entire database. The adapter reads conversation data from specific database keys and parses the embedded JSON structures.

## Installing into Cursor

Run `conclear install --cursor` to add ConClear as an MCP server at `~/.cursor/mcp.json` and (Cursor v2.2+) install the Skill at `~/.cursor/skills/conclear/SKILL.md`. See [Install into AI Clients](install.md).
