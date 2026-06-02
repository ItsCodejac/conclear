# Supported Tools

This page covers the AI coding tools ConClear **reads session data from**. For the separate list of AI clients ConClear can **install its MCP server into**, see [Install into AI Clients](install.md).

ConClear reads session data from five AI coding tools. Each tool stores session data in a different format and location. ConClear auto-detects which tools are installed by checking their standard data directories.

| Tool | Format | Data Location |
|------|--------|---------------|
| Claude Code | JSONL | `~/.claude/projects/` |
| Gemini CLI | JSON | `~/.gemini/tmp/` |
| Cursor | SQLite | `~/Library/Application Support/Cursor/` (macOS) |
| Cline / Roo Code | JSON | VS Code `globalStorage/` |
| GitHub Copilot | JSON | VS Code `workspaceStorage/` |

## Detection

On startup, ConClear checks each tool's data directory. If the directory exists, that adapter is activated and its sessions are included in the unified session list.

No configuration is needed. If you install a new tool later, ConClear will pick it up automatically on the next scan.

## Cross-Platform Paths

ConClear resolves data directories based on the current platform:

| Platform | VS Code / Cursor base |
|----------|-----------------------|
| macOS | `~/Library/Application Support/<app>/` |
| Windows | `%APPDATA%/<app>/` |
| Linux | `~/.config/<app>/` |
