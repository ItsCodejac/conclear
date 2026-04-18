# Session Browser

The session browser is the left pane of the web UI. It lists all detected sessions across all supported AI tools.

## Session List

Each session row displays:

- **Name** -- the session's custom name (if set) or a preview of the first user message.
- **Tool icon** -- which AI tool created the session (Claude, Cursor, Gemini, Cline, Copilot).
- **Project** -- the project directory associated with the session.
- **Timestamp** -- when the session was last active.
- **Size indicator** -- visual indicator of session size, color-coded by how large it is.
- **Image count** -- number of images embedded in the session.
- **Warning icon** -- amber icon if the session contains oversized images that could trigger dimension limit errors.

## Search

Press `/` to focus the search bar. Search filters sessions by name, preview text, and project name. Clear the search with Escape.

## Navigation

- `Up` / `Down` arrow keys navigate the session list.
- `Enter` selects the highlighted session.
- Click a session to select it.
- Double-click to expand to full-panel view.

## Sorting

Sessions are sorted by most recently active by default.

## Refresh

Press `Cmd+R` (macOS) or `Ctrl+R` to refresh the session list. The server re-scans all data directories and uses mtime-based caching to only re-parse changed files.
