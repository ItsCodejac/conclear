# Resize Images

Resizing shrinks images to a target file size while preserving visual content. This is a less aggressive alternative to stripping -- the images remain viewable but take less space.

## From the Web UI

1. Select a session and open the **Images** tab.
2. Click the resize button on individual images, or use the bulk resize action.
3. Choose a target size from the resize menu.
4. Confirm the operation.

## From the API

```
POST /api/sessions/:id/resize
Content-Type: application/json

{
  "imageIds": ["img-0", "img-1"],  // optional; omit to resize all
  "targetBytes": 102400             // target size per image (min 1024)
}
```

**Response:**

```json
{
  "backupPath": "/Users/you/.conclear/backups/session_backup_2024-01-15T10-30-00-000Z",
  "bytesReclaimed": 2150400
}
```

## How It Works

Resize uses the `sharp` library to:

1. Decode the base64 image data.
2. Progressively reduce dimensions and quality until the output is at or below the target byte size.
3. Re-encode as the original media type (or JPEG for lossy compression).
4. Replace the base64 data in the session file.

A backup is always created before modification.
