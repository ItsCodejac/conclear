# Strip Images

Stripping replaces image data in a session file with a tiny 1x1 pixel placeholder. The image metadata (position, media type) is preserved, but the large base64 payload is removed.

## From the Web UI

1. Select a session and open the **Images** tab.
2. To strip individual images: click the strip button on each image.
3. To strip all images: right-click the session and select "Strip all images", or use the bulk action in the toolbar.
4. Confirm the operation in the dialog.

A backup is created automatically before any modification.

## From the API

The server exposes a POST endpoint:

```
POST /api/sessions/:id/strip
Content-Type: application/json

{
  "imageIds": ["img-0", "img-1"]  // optional; omit to strip all
}
```

**Response:**

```json
{
  "backupPath": "/Users/you/.conclear/backups/session_backup_2024-01-15T10-30-00-000Z",
  "bytesReclaimed": 4521984
}
```

## How It Works

The strip operation reads the session file, finds image content blocks (identified by `type: "image"` with `source.type: "base64"`), and replaces the base64 data with a minimal 1x1 pixel PNG. The file is rewritten in place.

For Claude Code sessions (JSONL format), each line is processed independently. For JSON-based formats (Gemini, Cline, Copilot), the entire JSON structure is modified and rewritten.
