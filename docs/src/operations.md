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
