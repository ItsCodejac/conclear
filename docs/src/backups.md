# Backups

Every destructive operation in ConClear (strip images, resize images, redact secrets) writes a verified, timestamped backup of the affected session file to `~/.conclear/backups/` *before* it touches the original. The Backups page lets you see them, restore them, and clean them up.

## What's on it

- **Total stored** — chip showing combined backup size
- **Delete all** — bulk cleanup (with confirmation)
- **One row per backup** with:
  - Backup filename (encodes the project + session + ISO timestamp)
  - Relative age ("12m ago", "3d ago")
  - Action tag (`image strip`, `image resize`, `secret redact`)
  - Original path the backup came from
  - Backup size
  - **Restore** button — copies the backup back to its original path
  - **Close (×)** button — deletes just this backup

## How restore works

Each backup is paired with a sidecar `.meta.json` file:

```json
{
  "origPath": "/Users/you/.claude/projects/-Users-you-Projects-myapp/abc123.jsonl",
  "action": "redact",
  "createdAt": 1717459200000
}
```

`POST /api/backups/:name/restore` reads the sidecar, verifies the original parent directory still exists, and copies the backup back. The Restore button is disabled for legacy backups (pre-0.4) that don't have a sidecar — restore those manually from `~/.conclear/backups/`.

## What's safe

- Restore is non-destructive in one direction: it copies the backup *over* the current session file. If you want a backup of the *current* file before restoring, take one manually (or use any ConClear operation, which writes its own).
- Deleting a backup deletes the `.jsonl` file *and* its `.meta.json` sidecar.
- Sidecars are filtered out of the listing so they don't appear as their own entries.

## Storage

Backups grow over time. If `~/.conclear/backups/` gets large, **Delete all** is the cleanup. Nothing here is required for ConClear to function — backups are insurance, not state.

## Pairs with

- [Security](security.md) — redact's safety net
- [Strip Images](strip-images.md), [Resize Images](resize-images.md) — the other operations that write backups
