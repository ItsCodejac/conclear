# Operations

ConClear provides several operations for managing session data. All destructive operations create a timestamped backup before modifying any files.

## Safety

Before any operation that modifies a session file:

1. A backup is created in `~/.conclear/backups/`.
2. The backup is verified by comparing file sizes.
3. Only then is the original file modified.

Each backup also writes a `.meta.json` sidecar recording the original file path and the action that produced it (`strip` / `resize` / `redact`). The [Backups](backups.md) page uses these to offer one-click restore.

## Available Operations

- [Strip Images](strip-images.md) -- remove image data entirely, replacing with tiny placeholders.
- [Resize Images](resize-images.md) -- shrink images to a target file size.
- [File Recovery](file-recovery.md) -- recover previous file versions from session history.
- [Secret Scanning & Redact](secret-scanning.md) -- detect leaked credentials and rewrite them out of session files (with rotate links to actually invalidate them at the provider).
- [Export](export.md) -- export sessions as markdown documents.

For installing ConClear's MCP server (and Skill) into AI clients — a separate lifecycle from these data operations — see [Install into AI Clients](install.md).

## Update check

After CLI query commands, at web UI launch, and through the web version endpoint, ConClear checks whether a newer version is on npm and shows a one-line nudge (CLI: stderr; UI: a dismissable banner on Reclaim). This is the only network call ConClear makes: a version lookup for the `conclear` package against `registry.npmjs.org`, cached in `~/.conclear/update-check.json` for 24 hours. It sends nothing but the package name.

- Disable with `CONCLEAR_NO_UPDATE_CHECK=1`.
- Skipped automatically when `CI` is set.
- Never runs for `conclear mcp` — nothing extraneous is written on the MCP transport.
- Failures are silent: offline machines see no update-check errors. A stale-cache lookup can add up to 1.5 seconds; a cached version may still produce an update notice.
