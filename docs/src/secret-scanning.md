# Secret Scanning & Redact

ConClear scans session files for pasted API keys, tokens, AWS credentials, GitHub PATs, `.env` dumps, bearer tokens, database URLs, and other secrets that AI coding sessions accumulate. Findings can be redacted in place — with a verified backup written first — and every finding type that maps to a known provider gets a one-click rotation link.

The whole pipeline is local. Scans run against on-disk files, results never leave your machine.

## The loop

ConClear's security workflow has three steps and the UI is designed around all of them:

1. **Surface** — scanner finds a match, redacts it for display (first 4 / last 4 chars of the value), shows you where it is.
2. **Redact on disk** — one click rewrites the session file replacing the matched value with `****REDACTED****`. A timestamped backup is written first.
3. **Rotate at the provider** — the finding's type maps to a "Rotate at …" link that opens the right page (OpenAI / Anthropic, AWS IAM, GitHub tokens, GitHub SSH keys). Redacting the file does *not* invalidate the credential at the provider — rotating is the part that actually closes the leak.

## From the CLI

```bash
# Scan a single session
conclear scan my-session

# JSON output
conclear scan my-session --json
```

## From the Web UI

- **Global**: the Security page lists every finding across every scannable session. "Redact all" runs over the full set with one click. Per-finding scissors button redacts just that match.
- **Per-session**: open a session and switch to the Security tab for the same redact + rotate controls scoped to that session.

## From the API

```
GET  /api/sessions/:id/scan
POST /api/sessions/:id/redact          # body: { lineNumber?: number, type?: string }
POST /api/backups/:name/restore        # if you change your mind
```

## From MCP

Agents can call:

```
conclear_scan_secrets(session: "<name|id>")
```

Redact is intentionally *not* exposed via MCP — destructive operations always go through the UI for human confirmation.

## Finding types

Patterns and severities live in `src/server/adapters/secrets.ts` so they apply uniformly across every adapter that supports scanning.

| Type | Severity | What matches | Rotation target |
|---|---|---|---|
| `api_key` | high | `sk-…`, `sk-ant-…`, `sk-proj-…` (OpenAI / Anthropic shapes) | OpenAI / Anthropic API keys |
| `aws_key` | high | `AKIA[A-Z0-9]{16}` | AWS IAM |
| `aws_secret` | high | 40-char base64 near an `aws_secret` keyword | AWS IAM |
| `private_key` | high | `-----BEGIN ... PRIVATE KEY-----` | GitHub SSH keys (or your provider) |
| `github_token` | high | `ghp_`, `gho_`, `ghs_`, `github_pat_` | GitHub tokens |
| `bearer_token` | high | `Bearer <20+ chars>` | (no fixed URL — rotate at issuer) |
| `env_credential` | medium | `PASSWORD=…`, `SECRET=…`, `TOKEN=…`, `API_KEY=…` | (no fixed URL) |
| `database_url` | medium | `postgres://user:pass@…` and friends | (no fixed URL) |
| `webhook_token` | medium | webhook URLs with long opaque tail | (no fixed URL) |
| `env_file` | low | `read/write/load/cat/source .env` | (informational) |
| `sensitive_path` | low | paths under `credentials/`, `secrets/`, `keys/` | (informational) |

## Display redaction vs file redaction

There are two layers of redaction and they're independent:

- **Display redaction**: the scanner always shows `<first 4>****<last 4>` so the UI itself never leaks the secret. This happens whether or not you've redacted the file.
- **File redaction**: only runs when you click Redact. Rewrites the session file with `****REDACTED****` and writes a backup. Reversible from the Backups page.

## Coverage

| Tool | Scan | Redact |
|---|---|---|
| Claude Code | ✓ | ✓ |
| Cline / Roo Code | ✓ | ✓ |
| Gemini CLI | ✓ | ✓ |
| Cursor | ✓ | — (SQLite-blob rewrite deferred — rotate + delete the session in Cursor) |
| GitHub Copilot Chat | — | — |

## Limitations

The scanner uses regex pattern matching and can produce false positives — `aws_secret` in particular requires a nearby `aws_secret` / `AWS_SECRET` keyword to avoid every 40-character base64 string registering as one. It's not a replacement for `trufflehog` or `gitleaks`; it's a fast first pass against the specific failure mode of pasting secrets into AI chat.
