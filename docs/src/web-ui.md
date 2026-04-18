# Web UI

The ConClear web UI is a React application served by a local Express server on port 3789. Launch it with:

```bash
conclear
```

## Layout

The UI uses a pane layout with two main areas:

- **Left pane** -- session list with search, sort, and filter controls.
- **Right pane** -- detail view with tabs for the selected session.

Double-click a session to expand it to full-panel mode. Press Escape to return to the split view.

## Tabs

When you select a session, the detail pane shows these tabs:

| Tab | Content |
|-----|---------|
| Images | Thumbnails of all images in the session, with strip/resize controls |
| Timeline | Chronological event log of all operations |
| Chat | Conversation replay with user/assistant messages |
| Files | File version history with syntax-highlighted viewer |

## Context Menu

Right-click a session to access:

- Strip all images
- Resize all images
- Copy resume command
- Export as markdown
- Scan for secrets

## Toolbar

The toolbar at the top of the detail pane shows:

- Session name and metadata (message count, image count, total size)
- Tab switcher
- Action buttons for the current tab
- Help button (`?`)
