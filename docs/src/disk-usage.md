# Disk Usage

ConClear tracks the disk usage of each session and provides visual indicators to help you identify which sessions are consuming the most space.

## Size Indicator

Each session in the browser shows a size indicator that is color-coded:

- **Green** -- small session, nothing to worry about.
- **Yellow** -- moderate size, may contain images worth reviewing.
- **Red** -- large session, likely bloated with image data.

## Session Detail

When you select a session, the toolbar shows:

- **Total size** -- the full size of the session file on disk.
- **Image size** -- how much of that total is image data (base64-encoded).
- **Tool result size** -- size of tool use results (command output, file contents, etc.).
- **Message count** -- total number of messages in the session.
- **Image count** -- number of embedded images.

## Identifying Bloat

The difference between total size and image size tells you how much of the session is actual conversation vs. image data. Sessions where images account for more than 50% of the total size are good candidates for cleanup.

## Backup Management

After strip or resize operations, backups are stored in `~/.conclear/backups/`. The backup manager (accessible from the UI) lets you view, restore from, or delete old backups.
