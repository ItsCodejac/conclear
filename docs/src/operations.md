# Operations

ConClear provides several operations for managing session data. All destructive operations create a timestamped backup before modifying any files.

## Safety

Before any operation that modifies a session file:

1. A backup is created in `~/.conclear/backups/`.
2. The backup is verified by comparing file sizes.
3. Only then is the original file modified.

Backups can be managed from the web UI's backup manager or by directly accessing the backup directory.

## Available Operations

- [Strip Images](strip-images.md) -- remove image data entirely, replacing with tiny placeholders.
- [Resize Images](resize-images.md) -- shrink images to a target file size.
- [File Recovery](file-recovery.md) -- recover previous file versions from session history.
- [Secret Scanning](secret-scanning.md) -- detect leaked credentials in session data.
- [Export](export.md) -- export sessions as markdown documents.
