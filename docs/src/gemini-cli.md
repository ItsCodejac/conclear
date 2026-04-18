# Gemini CLI

## Data Format

Gemini CLI stores sessions as JSON files within a project-specific directory structure.

## Data Location

```
~/.gemini/tmp/<project-hash>/chats/session-<id>.json
```

Each session file is a complete JSON document containing the full conversation with all messages, tool uses, and embedded images.

## Features Supported

- Session listing with metadata
- Image preview, strip, and restore
- Conversation replay
- Mtime-based caching for fast re-scans

## Detection

ConClear checks for the existence of `~/.gemini/` to determine if Gemini CLI is installed. It then scans all project directories under `~/.gemini/tmp/` for `chats/session-*.json` files.
