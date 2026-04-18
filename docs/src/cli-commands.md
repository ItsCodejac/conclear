# Commands

## conclear search

Full-text search across all session messages.

```bash
conclear search <query> [--project <name>] [--limit <n>] [--json]
```

| Option | Description |
|--------|-------------|
| `--project <name>` | Filter to sessions whose project name contains this string |
| `--limit <n>` | Maximum results to return (default: 10) |
| `--json` | Output as JSON |

Output includes session name, timestamp, role (user/assistant), and a text snippet around the match.

## conclear files

Find file versions matching a path pattern across sessions.

```bash
conclear files <path-pattern> [--session <name-or-id>] [--latest] [--json]
```

| Option | Description |
|--------|-------------|
| `--session <name-or-id>` | Restrict search to a specific session |
| `--latest` | Include the content of the latest version |
| `--json` | Output as JSON |

The path pattern supports `*` and `**` glob syntax. When `--latest` is used with a single matching file, the content is written to stdout for piping.

## conclear sessions

List all indexed sessions, sorted by most recently active.

```bash
conclear sessions [--project <name>] [--limit <n>] [--json]
```

| Option | Description |
|--------|-------------|
| `--project <name>` | Filter by project name |
| `--limit <n>` | Maximum sessions to show (default: 20) |
| `--json` | Output as JSON |

Table output shows: name, project, last active date, message count, image count, and size.

## conclear summary

Quick summary of a specific session.

```bash
conclear summary <session-name-or-id> [--json]
```

Output includes:
- Session metadata (ID, name, project, dates)
- Message and image counts
- File size
- List of files touched (up to 20)
- Key user messages (up to 5)

## conclear context

Dump clean conversation text from a session. Includes only user and assistant messages -- no tool results or protocol noise.

```bash
conclear context <session-name-or-id> [--json]
```

Useful for piping session context into other tools:

```bash
conclear context my-session | head -200
```

## conclear export

Export a session as a clean markdown or text document.

```bash
conclear export <session-name-or-id> [--output <file>] [--format md|txt]
```

| Option | Description |
|--------|-------------|
| `--output <file>`, `-o <file>` | Write to file instead of stdout |
| `--format md\|txt` | Output format (default: `md`) |

The `txt` format strips markdown syntax (headings, bold, code fences) for plain text output.

## conclear scan

Scan a session for potential secrets, API keys, and credentials.

```bash
conclear scan <session-name-or-id> [--json]
```

Output groups findings by severity (high, medium, low) and shows:
- Type (e.g., `api_key`, `bearer_token`, `aws_key`)
- Redacted pattern (first 4 and last 4 characters)
- Surrounding context
- Line number in the session file
