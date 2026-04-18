# Introduction

ConClear is a visual utility and CLI for managing AI coding tool session data. It reads session files from Claude Code, Cursor, Gemini CLI, Cline/Roo Code, and GitHub Copilot, giving you a unified view of your AI coding history.

## The Problem

Every time you paste a screenshot into an AI coding tool, that image data stays in the session file forever. Sessions grow to 50MB, 100MB, or more. Eventually you hit errors like:

```
An image in the conversation exceeds the dimension limit for many-image requests (2000px).
Run /compact to remove old images from context, or start a new session.
```

ConClear gives you a better option than `/compact` or starting over.

## What ConClear Does

- **Session browsing** -- scan all your AI tool data and see exactly what's taking space.
- **Image cleanup** -- preview every screenshot in a session. Strip them (replace with a tiny placeholder), resize them, or leave them alone. Per-image or in bulk.
- **File version history** -- every file your AI tool read, edited, or wrote is tracked. Browse versions, view with syntax highlighting, compare diffs, copy code.
- **Conversation replay** -- read past sessions with clean formatting. Search, filter by role, export as markdown.
- **Timeline** -- event log of everything that happened: edits, bash commands, file reads, errors.
- **Secret scanning** -- detect API keys, tokens, and credentials that may have leaked into session data.
- **CLI query interface** -- search sessions, recover files, and dump context from the terminal without starting the server.
- **MCP server** -- expose session history to AI agents via the Model Context Protocol.

## Privacy

ConClear runs entirely on your local machine. No data is sent anywhere. The server reads session files directly from disk and serves them to the React frontend on `localhost`.
