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
- Conversation replay
- Backup of the database file before modifications

## Notes

Since Cursor uses a single SQLite database rather than individual session files, backups copy the entire database. The adapter reads conversation data from specific database keys and parses the embedded JSON structures.
