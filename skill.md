# ConClear — AI Session History

ConClear indexes AI coding tool session history for search, file recovery, and context restoration.

## Installation

This skill is installed automatically by `conclear install` (or `conclear install --claude-code`). Skill install also works for Cursor (v2.2+) and Google Antigravity. Install the `conclear` CLI first: `npm install -g conclear`.

## Commands

Run via Bash — no server needed.

| Command | Description |
|---|---|
| `conclear search <query>` | Full-text search across past sessions |
| `conclear files <pattern>` | Find file versions from past sessions |
| `conclear sessions` | List all indexed sessions |
| `conclear summary <session>` | Get a session overview |
| `conclear context <session>` | Dump full conversation from a session |
| `conclear export <session>` | Export session as markdown |

All commands support `--json` for structured output. Session lookup supports partial names, IDs, or preview text.

## When to Use

- **"What did we discuss about X?"** → `conclear search "X"`
- **"Show me the old version of file Y"** → `conclear files "Y" --latest`
- **"What happened in the last session?"** → `conclear sessions` then `conclear summary <id>`
- **"Give me context from that conversation"** → `conclear context <session>`
- **"Export that session for reference"** → `conclear export <session> --output session.md`

## Examples

```bash
# Search for a past discussion
conclear search "auth middleware" --project myapp --limit 5

# Recover a file version
conclear files "api.ts" --session veesty-rebuild-plan --latest > recovered.ts

# Get a quick overview
conclear summary veesty-rebuild-plan

# Pipe context into current work
conclear context my-session | head -200
```
