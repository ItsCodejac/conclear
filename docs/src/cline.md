# Cline & Roo Code

## Data Format

Both Cline and Roo Code use the same directory structure under VS Code's `globalStorage`. Each task (session) has its own directory containing JSON files.

## Data Location

```
# Cline
<VS Code globalStorage>/saoudrizwan.claude-dev/tasks/<task-id>/

# Roo Code
<VS Code globalStorage>/rooveterinaryinc.roo-cline/tasks/<task-id>/
```

Where VS Code `globalStorage` is:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/Code/User/globalStorage/` |
| Windows | `%APPDATA%/Code/User/globalStorage/` |
| Linux | `~/.config/Code/User/globalStorage/` |

## Features Supported

- Session listing with metadata
- Image preview, strip, resize, and restore
- Conversation replay

## Notes

ConClear scans both Cline and Roo Code directories. Sessions from both tools appear in the unified session list, distinguished by their tool label.
