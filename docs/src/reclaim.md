# Reclaim

The Reclaim page is the landing page of the Web UI. It answers the question *"what's taking space, what's risky, and what should I do first?"*

## What's on it

**Hero stat** — total session data on disk, with image bytes called out separately (those are the recoverable bytes). One-click button: "Clean N problem sessions" runs a guided resize against every session ConClear flagged as oversized.

**Side cards** — image-vs-other byte breakdown, and a "Needs attention" counter that combines oversized-image sessions and sessions with secret findings.

**Per-project breakdown** — sorted by total bytes, with a meter showing how much of each project's data is images vs other content. Click a project to filter the Sessions page.

**Per-tool breakdown** — same idea but grouped by AI tool (Claude Code, Cursor, Cline, …). Useful for spotting "oh, all my bloat is from one tool."

**Problem sessions list** — sessions flagged as oversized, in size order. Each row links straight to the session detail view.

## First-run onboarding

If no AI clients have ConClear's MCP installed yet, a banner appears above the hero pointing you to Connect with the bulk-install primed. Dismiss it once and it stays dismissed.

## Pairs with

- [Sessions](session-browser.md) — drill into individual sessions
- [Security](security.md) — the other "needs attention" lane
- [Connect](connect.md) — install MCP into AI clients
