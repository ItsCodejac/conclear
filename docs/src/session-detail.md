# Session Detail Tabs

Open a session from the Sessions page and ConClear shows you a tabbed detail view. Tabs only appear for capabilities the adapter actually supports — a tab is grayed out if the session's tool doesn't implement it.

| Tab | What it shows | Adapters |
|---|---|---|
| Summary | Files touched, key user messages, totals | all |
| Images | Inline previews of every screenshot in the session, with strip / resize / lightbox | all |
| Chat | Clean conversation viewer with role filters | all |
| Timeline | Every event in the session (edit, write, bash, search, image, error), paginated at 200 rows | all |
| Files | Per-file version history with syntax highlighting and diff view | Claude, Cline |
| Security | Findings from the scanner with rotate links and per-finding redact | Claude, Cline, Gemini, Cursor (scan only) |

## Header

Above the tabs:

- Session name with a colored health dot (red = high-severity finding, amber = oversized images, lime = clean)
- Tool badge + project + message + image + size counts
- Cost / usage tags (Cline today — tokens in / out, cache hits, total USD)
- **Copy resume command** — copies `<tool> --resume "<session>"` to clipboard
- **Export** — downloads markdown (where supported)
- **Close**

## Cached scan

The Security tab consumes the same module-level scan cache as the global Security page. Opening the tab doesn't re-scan; results are instant if the global scan has already touched this session.

## Pairs with

- [Sessions](session-browser.md) — the list view
- [Security](security.md) — the global security surface
