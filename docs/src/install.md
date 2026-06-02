# Install into AI Clients

`conclear install` wires ConClear's MCP server (and Skill, where supported) into your AI clients in one step — no hand-editing of config files.

```bash
conclear install
```

By default this detects every supported client on your machine and installs into each one. To inspect what's installed afterward:

```bash
conclear doctor
```

To remove:

```bash
conclear uninstall
```

## Supported clients

| Client | MCP install | Skill install | Method |
|---|---|---|---|
| Claude Code | ✓ | ✓ | `claude mcp add` (file fallback) |
| Claude Desktop | ✓ | — | file (restart required) |
| Cursor | ✓ | ✓ | file |
| Windsurf | ✓ | — | file |
| VS Code (Copilot Chat) | ✓ | — | `code --add-mcp` (file fallback) |
| Google Antigravity | ✓ | ✓ | file |
| Zed | ✓ | — | JSONC-aware file (comments preserved) |
| Cline | ✓ | — | file |
| Codex CLI | ✓ | — | `codex mcp add` (TOML fallback) |
| Kiro CLI | ✓ | — | file |
| Continue | manual | — | YAML snippet printed |

Continue uses a YAML config; rather than ship a YAML parser dependency, ConClear prints the exact snippet to paste. Everything else is automated.

## Flags

| Flag | Behavior |
|---|---|
| _(none)_ | Install for every detected client |
| `--all` | Install for every supported client, even undetected ones |
| `--<client-id>` | Install only for the named client(s) — see IDs below |
| `--no-skill` | Skip skill install; MCP only |

Client IDs match the "Method" rows above: `claude-code`, `claude-desktop`, `cursor`, `windsurf`, `vscode`, `antigravity`, `zed`, `cline`, `continue`, `codex`, `kiro`.

```bash
conclear install --claude-code --cursor
conclear install --all --no-skill
conclear uninstall --zed
```

## What it writes

For each client, `install` adds a single MCP server entry named `conclear` pointing at `conclear mcp`. Per-client schema details (VS Code's `servers` key + `type: stdio`, Zed's `context_servers` + required `source: "custom"`, Antigravity's `serverUrl` for remote servers) are handled automatically.

When a client supports skills, the bundled `skill.md` is copied to:

- Claude Code: `~/.claude/skills/conclear/SKILL.md`
- Cursor (v2.2+): `~/.cursor/skills/conclear/SKILL.md`
- Google Antigravity: `~/.gemini/config/skills/conclear/SKILL.md`

## Backups

Before any config edit, the original file is copied to `~/.conclear/backups/` with a timestamp. Uninstall and re-install both create their own backups.

## Doctor

`conclear doctor` prints a per-client status table:

```
ConClear install status:

  Claude Code            detected  mcp:on   skill:on
  Claude Desktop         detected  mcp:on
  Cursor                 detected  mcp:off  skill:off
  Windsurf               detected  mcp:off
  VS Code                detected  mcp:off
  Google Antigravity     detected  mcp:on   skill:on
  Zed                    detected  mcp:off
  Cline                  —         mcp:off
  Continue               —         mcp:off
    ! YAML config — install is manual
  Codex CLI              detected  mcp:off
  Kiro CLI               —         mcp:off
    ! Kiro config path inherited from Amazon Q Developer — verify after install
```

Per-client notes surface known footguns (e.g. Windsurf's ~100-tool cap).

## Manual configuration

If you'd rather wire ConClear up by hand — for unsupported clients, or to use a custom command path — the canonical MCP entry is:

```json
{
  "mcpServers": {
    "conclear": {
      "command": "conclear",
      "args": ["mcp"]
    }
  }
}
```

VS Code uses `servers` instead of `mcpServers` and requires `"type": "stdio"`. Zed nests under `context_servers` and requires `"source": "custom"`.

## HTTP transport

For clients that prefer Streamable HTTP, or for sharing one server across multiple clients:

```bash
conclear mcp --http --port 7331
```

Stdio remains the default; SSE is not supported (deprecated upstream).
