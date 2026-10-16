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
| `conclear context <session>` | Bounded conversation pages with references and completeness metadata |
| `conclear scan <session>` | Scan a session for leaked API keys, tokens, .env dumps |
| `conclear export <session>` | Export session as markdown |

Search, sessions, files, summary, context, and scan support `--json` for structured output. Export writes a Markdown or text document. Session lookup accepts ID prefix, exact name, or partial name match.

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

# Retrieve a bounded page; follow returned cursors only as needed
conclear context my-session --limit 10 --max-chars 6000 --json
```

## MCP tools

The same surface is also available to agents through MCP — `conclear install` wires it into the supported clients. Tools: `conclear_recovery`, `conclear_sessions`, `conclear_search`, `conclear_summary`, `conclear_context`, `conclear_files`, `conclear_file_content`, `conclear_scan_secrets`. All read-only; redact is intentionally only exposed through the web UI so it always goes through human confirmation.

## Capability notes per tool

- **Claude Code, Cline / Roo Code** — full support (read, files, scan, export).
- **Gemini CLI** — read, scan, export. No file history yet.
- **Cursor** — read + scan. File history and redact not implemented (SQLite-blob rewrite is risky while Cursor is running).
- **GitHub Copilot Chat** — read only.

## Bounded retrieval workflow

Search JSON returns `{ matches, coverage }`; context JSON returns `{ messages, page, ... }`.

1. Search narrowly: `conclear search "topic" --project myapp --limit 5 --json`.
2. Open a hit: `conclear context SESSION_ID --tool TOOL --around MESSAGE_REF --before 1 --after 3 --max-chars 6000 --json`.
3. If more evidence is needed, pass `page.nextCursor` as `--cursor`, with the same session/tool. It resumes at the first unread character. Use `previousCursor` for earlier messages. Do not combine a cursor with around/before/after/offset.
4. For a deep match, use `--around MESSAGE_REF --before 0 --offset MATCH_OFFSET`.

Check coverage before drawing conclusions. `windowComplete` is not whole-conversation completeness; `page.complete` is. A timestamp says when a statement was recorded, not whether it remains valid. Inspect later evidence when an answer depends on an earlier claim; do not assume a later message automatically disproves it. Cite message references for consequential claims.

Defaults: last 20 messages, 12,000 text characters shared across the page. Long messages have offsets and a partial flag; continuation retrieves the rest. Changed conversations require fresh cursors; changed messages require fresh references. ConClear retrieves evidence and does not certify conclusions or maintain project beliefs.

Independent recovery is available through `conclear recovery --help` and the Recovery page. Enrollment is explicit; macOS launchd/Linux systemd user services can keep capture independent of the agent. `conclear_recovery` reads observer health and paginated points. Pins and restores require explicit CLI/UI actions. Observed bytes are evidence, not proof of working code or complete capture.
