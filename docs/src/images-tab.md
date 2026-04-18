# Images Tab

The Images tab shows all images embedded in the selected session. Each image is displayed as a thumbnail with metadata.

## Image Details

For each image, you can see:

- **Thumbnail preview** -- loaded on demand to avoid fetching all image data at once.
- **Size** -- the base64-encoded size in the session file.
- **Media type** -- e.g., `image/png`, `image/jpeg`.
- **Context** -- where in the conversation the image appears.
- **Timestamp** -- when the image was shared (if available).

## Image Actions

Click an image thumbnail to open it in a lightbox at full resolution. Press Escape to close.

### Per-Image Actions

- **Strip** -- replace the image with a tiny 1x1 pixel placeholder. The session file is rewritten with the base64 data removed.
- **Resize** -- shrink the image to a target file size using the resize menu.

### Bulk Actions

- **Strip All** -- strip every image in the session at once.
- **Resize All** -- resize all images to a target size.

Both bulk operations create a backup before modifying the session file.

## Oversized Image Detection

Images that exceed the 2000px dimension limit are flagged. ConClear detects these proactively so you can fix them before hitting the error during a session.
