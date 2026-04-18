# Secret Scanning

ConClear can scan session data for potential secrets, API keys, and credentials that may have been inadvertently captured during AI coding sessions.

## From the CLI

```bash
conclear scan my-session
```

Output groups findings by severity and shows the type, a redacted pattern, and surrounding context.

```bash
# JSON output for programmatic use
conclear scan my-session --json
```

## From the Web UI

Right-click a session and select "Scan for secrets". Results are displayed in the scan results panel.

## From the API

```
GET /api/sessions/:id/scan
```

## Finding Types

| Type | Severity | Description |
|------|----------|-------------|
| `api_key` | high | Generic API key patterns |
| `bearer_token` | high | Bearer authentication tokens |
| `aws_key` | high | AWS access key IDs and secret keys |
| `private_key` | high | PEM-encoded private keys |
| `env_file` | medium | Environment variable assignments with sensitive names |

## Redaction

All findings are redacted in the output -- only the first 4 and last 4 characters of matched patterns are shown. This prevents the scanner itself from leaking secrets.

## Limitations

The scanner uses pattern matching and may produce false positives. It is not a substitute for dedicated secret scanning tools like `trufflehog` or `gitleaks`, but provides a quick check for obvious leaks in session data.
