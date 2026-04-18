# GitHub Copilot

## Data Format

GitHub Copilot Chat stores conversation data as JSON files within VS Code's `workspaceStorage` directory.

## Data Location

```
<VS Code workspaceStorage>/<workspace-hash>/
```

Where VS Code `workspaceStorage` is:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/Code/User/workspaceStorage/` |
| Windows | `%APPDATA%/Code/User/workspaceStorage/` |
| Linux | `~/.config/Code/User/workspaceStorage/` |

## Features Supported

- Session listing with metadata
- Image preview, strip, and restore
- Conversation replay

## Detection

ConClear scans the workspace storage directory for Copilot chat data files. Sessions are included in the unified list alongside other tools.
