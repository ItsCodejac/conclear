# ConClear — AI Session History

ConClear indexes AI coding tool session history for search, file recovery, secret scanning, and context restoration. Works across Claude Code, Cursor, Gemini CLI, Cline / Roo Code, and GitHub Copilot.

## Installation

This skill is installed automatically by `conclear install` (or `conclear install --claude-code`). Skill install also works for Cursor (v2.2+) and Google Antigravity. Install the `conclear` CLI first: `npm install -g conclear`.

## Commands

Run via Bash — no server needed.

| Command | Description |
|---|---|
| `conclear sessions` | List all indexed sessions, most recently active first |
| `conclear search <query>` | Full-text search across every session |
| `conclear files <pattern>` | Find file versions from past sessions |
| `conclear summary <session>` | Session digest: files touched + key messages |
| `conclear context <session>` | Clean user / assistant conversation text |
| `conclear scan <session>` | Scan a session for leaked API keys, tokens, .env dumps |
| `conclear export <session>` | Export session as markdown |

All commands support `--json` for structured output. Session lookup accepts ID prefix, exact name, or partial name match.

## When to Use

- **"What did we discuss about X?"** → `conclear search "X"`
- **"Show me the old version of file Y"** → `conclear files "Y" --latest`
- **"Did we ever leak an API key in that chat?"** → `conclear scan <session>`
- **"What happened in the last session?"** → `conclear sessions` then `conclear summary <id>`
- **"Give me context from that conversation"** → `conclear context <session>`
- **"Export that session for reference"** → `conclear export <session> --output session.md`

## Examples

```bash
# Search for a past discussion
conclear search "auth middleware" --project myapp --limit 5

# Recover a file version
conclear files "api.ts" --session veesty-rebuild-plan --latest > recovered.ts

# Check a session for leaked credentials before sharing it
conclear scan veesty-rebuild-plan

# Pipe conversation context into the current chat
conclear context my-session | head -200
```

## MCP tools

The same surface is also available to agents through MCP — `conclear install` wires it into the supported clients. Tools: `conclear_sessions`, `conclear_search`, `conclear_summary`, `conclear_context`, `conclear_files`, `conclear_file_content`, `conclear_scan_secrets`. All read-only; redact is intentionally only exposed through the web UI so it always goes through human confirmation.

## Capability notes per tool

- **Claude Code, Cline / Roo Code** — full support (read, files, scan, export).
- **Gemini CLI** — read, scan, export. No file history yet.
- **Cursor** — read + scan. File history and redact not implemented (SQLite-blob rewrite is risky while Cursor is running).
- **GitHub Copilot Chat** — read only.
