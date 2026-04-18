# Claude Code

## Data Format

Claude Code stores sessions as JSONL (JSON Lines) files. Each line is a self-contained JSON object representing a message or event.

## Data Location

```
~/.claude/projects/<project-dir>/<session-id>.jsonl
```

Project directories are named with an encoded path, e.g., `-Volumes-4tbCache--Projects-ConClear`.

Session metadata (including custom names set via `/resume`) is stored separately:

```
~/.claude/sessions/<session-id>.json
```

## Session Structure

Each JSONL line has a `type` field:

- `user` -- user message
- `assistant` -- assistant response
- `result` -- tool result

Messages contain a `message` object with `role` and `content`. Content can be a string or an array of content blocks:

- `text` blocks -- plain text
- `image` blocks -- base64-encoded images with `source.type: "base64"`
- `tool_use` blocks -- tool invocations
- `tool_result` blocks -- tool outputs

## Features Supported

- Full session listing with metadata
- Image preview, strip, resize, and restore
- Conversation replay
- Timeline event extraction
- File version history with content recovery
- Secret scanning
- Markdown export
- Mtime-based caching for fast re-scans

## Session Name Resolution

ConClear cross-references JSONL filenames with `~/.claude/sessions/*.json` metadata files to display custom session names set via Claude Code's `/resume` command.
