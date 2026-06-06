# Introduction

ConClear is a local utility for managing AI coding session data — disk space, leaked secrets, lost files, and conversation history — across every major AI coding tool. It reads session files directly from disk, gives you a unified view, and hands the same data to your agents through MCP. Nothing leaves your machine.

## The four things it does

- **Reclaim disk space.** Every screenshot you paste into a session sits in that file forever. ConClear finds them, shows them, and lets you strip or resize them — per-image or in bulk. Sessions go from 100 MB+ back to a few MB.
- **Find and redact leaked credentials.** Pasted API keys, AWS keys, GitHub PATs, bearer tokens, `.env` dumps. ConClear scans for them, shows where they are, redacts them in place with one click (backup written first), and links to the right rotation page so you actually roll the key.
- **Recover lost work.** Every file your agent read, wrote, or edited is preserved with full content and version history. Open the session, browse versions, view with syntax highlighting, copy the code back out.
- **Bridge sessions to your agents.** ConClear ships an MCP server that you install into 11 AI clients with one command. Agents can then search, summarize, list files, scan secrets, and pull conversation context from any past session — without leaving the chat.

## Why this matters

Pasted screenshots break agents downstream:

```
An image in the conversation exceeds the dimension limit for many-image requests (2000px).
Run /compact to remove old images from context, or start a new session.
```

Pasted credentials end up archived in plaintext, surviving the conversation, sometimes the project, sometimes the laptop. Lost agent edits get re-asked from memory. Every one of these is solvable — they just need a tool that treats session history as a first-class, queryable, mutable resource.

## Privacy

ConClear runs entirely on your machine. There is no cloud, no telemetry, no account, no upload. Session data is read from local disk, displayed in a local web UI on `localhost:3789`, and mutated only in place (with verified, restorable backups). The MCP server runs locally and is spawned on demand by each client — there is no persistent process.
