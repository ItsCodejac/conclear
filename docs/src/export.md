# Export

ConClear can export sessions as clean markdown or plain text documents.

## From the CLI

```bash
# Export as markdown (default)
conclear export my-session --output session.md

# Export as plain text
conclear export my-session --output session.txt --format txt

# Write to stdout
conclear export my-session
```

## From the Web UI

- Right-click a session and select "Export as markdown".
- The browser downloads a `.md` file named after the session.

## From the API

```
GET /api/sessions/:id/export
```

Returns a markdown file as an attachment download. The `Content-Disposition` header includes a sanitized filename based on the session name.

## Markdown Format

The exported markdown includes:

- Session metadata header (name, project, dates)
- All user and assistant messages with timestamps
- Clean formatting with role labels
- Code blocks preserved

## Plain Text Format

When `--format txt` is used, the exporter strips markdown syntax:

- Heading markers (`#`) are removed
- Bold markers (`**`) are removed
- Blockquotes (`>`) become indentation
- Code fences are removed (code content is preserved)
