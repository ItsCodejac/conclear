# Security

The Security page is where ConClear's secrets pipeline lives. It scans every session that supports scanning, surfaces what it found, and lets you redact and rotate in one place.

## What's on it

**Three stat cards** — total findings, high-severity count, and `scanned X / Y` progress for the supported-tool subset.

**Per-session groups** — each session that has findings gets its own group, sorted by finding count. Click the session name to open it.

**Per-finding row** — for every match:

- Severity pill (high / medium / low)
- Pattern type (`api_key`, `aws_key`, `github_token`, `bearer_token`, `private_key`, `env_credential`, `database_url`, `webhook_token`, `env_file`, `sensitive_path`)
- Redacted preview of the actual value (first 4 / last 4 chars)
- Line number where it was found
- Surrounding context (≤120 chars, secret itself redacted)
- **Rotate this key** link to the provider's rotation page where one exists
- **Scissors button** to redact just this finding
- **Chevron** to open the session at this point

**Redact all** button at the top loops every session-with-findings and redacts them all. Always writes a backup first.

## Scan cache

The scanner is shared across the whole app — the per-session Security tab, the sidebar count, the SessionDetail header badge, and this page all read from the same module-level cache. Cache persists to `localStorage` so the next cold start has a result to show within milliseconds while the live scan refreshes in the background.

Force a fresh scan with **Rescan all**.

## Redact, then rotate

Redacting removes the secret from the *session file*. It does not invalidate the credential at the provider. The Rotate links exist because every redact-without-rotate is a half-done fix:

| Finding type | Rotation target |
|---|---|
| `api_key` | OpenAI / Anthropic API keys page |
| `aws_key`, `aws_secret` | AWS IAM security credentials |
| `github_token` | GitHub developer settings → tokens |
| `private_key` | GitHub settings → SSH keys (or your relevant provider) |
| `bearer_token`, `database_url`, `webhook_token`, `env_credential` | No single URL — rotate at whatever issued it |

## What gets scanned

Patterns and their severities live in `src/server/adapters/secrets.ts`. The same table is used by every adapter so additions land everywhere at once.

| Tool | Scan | Redact |
|---|---|---|
| Claude Code | ✓ | ✓ |
| Cline / Roo Code | ✓ | ✓ |
| Gemini CLI | ✓ | ✓ |
| Cursor | ✓ | — (use Rotate links + delete session in Cursor) |
| GitHub Copilot Chat | — | — |

## Pairs with

- [Backups](backups.md) — every redact writes a restorable backup
- [Secret Scanning & Redact](secret-scanning.md) — operational deep-dive
