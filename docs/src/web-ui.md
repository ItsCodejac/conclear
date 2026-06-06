# Web UI

The ConClear web UI is a React + Vite application served by a local Express server on port 3789. Launch it with:

```bash
conclear
```

The UI is dark-only and uses the Signal Lime accent system (`#cbf24e`). Nothing in it sends data anywhere — everything is local file I/O over a localhost socket.

## Layout

A single-window shell with three regions:

- **Titlebar** — brand, global search palette (`⌘K`), MCP chip, total bytes, rescan button.
- **Left rail** — top-level navigation: Reclaim, Sessions, Security, Connect, Backups, Settings. Counts on the right side of each item (Sessions count, Security count with alert styling when > 0, Connect count of installed clients).
- **Main pane** — the active page.

When you open a session from the Sessions page, the detail view replaces the main pane with a tabbed view (Summary / Images / Chat / Timeline / Files / Security) — see [Session Detail Tabs](session-detail.md).

## Pages

| Page | Purpose | Doc |
|---|---|---|
| Reclaim | Overview — what's taking space, what needs attention | [reclaim.md](reclaim.md) |
| Sessions | Per-tool session list with project grouping, filtering, sorting | [session-browser.md](session-browser.md) |
| Security | Findings across every scanned session, with redact + rotate | [security.md](security.md) |
| Connect | Install ConClear into AI clients (MCP + Skill) | [connect.md](connect.md) |
| Backups | Every restore point with action + origin + Restore button | [backups.md](backups.md) |

## Keyboard

| Key | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Open search palette (global across sessions, messages, files) |
| `⌘R` / `Ctrl+R` | Rescan sessions |
| `Esc` | Close palette / detail view / lightbox |

See [Keyboard Shortcuts](keyboard-shortcuts.md) for the full list.

## Caching

To make navigation feel instant:

- **Sessions** hydrate from `localStorage` on cold start, with a background refresh.
- **Scan results** are kept in a module-level singleton shared by the sidebar count, the Security page, the per-session Security tab, and the SessionDetail header. Switching pages never re-scans.
- **Backups** list is fetched fresh per visit (cheap; small directory listing).

## Demo mode

If you want to explore the UI without your real session data, launch with `conclear --demo` — every adapter is rerooted at the bundled fixtures.
