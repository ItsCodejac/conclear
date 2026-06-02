# Examples

## Search for a past discussion

```bash
conclear search "auth middleware" --project myapp --limit 5
```

## Find and recover a file version

```bash
# List all versions of a file across sessions
conclear files "api.ts"

# Get the latest version from a specific session
conclear files "api.ts" --session veesty-rebuild-plan --latest

# Pipe the content directly into a new file
conclear files "api.ts" --session veesty-rebuild-plan --latest > recovered.ts
```

## Review recent sessions

```bash
# List the 10 most recent sessions
conclear sessions --limit 10

# Filter by project
conclear sessions --project ConClear
```

## Get a session summary

```bash
conclear summary veesty-rebuild-plan
```

## Export a session for reference

```bash
# Export as markdown
conclear export my-session --output session.md

# Export as plain text
conclear export my-session --output session.txt --format txt
```

## Pipe context into current work

```bash
# Get the last 200 lines of conversation
conclear context my-session | head -200

# Use with AI tools that accept stdin
conclear context my-session | pbcopy
```

## Scan for leaked secrets

```bash
# Human-readable output
conclear scan my-session

# JSON for programmatic use
conclear scan my-session --json
```

## JSON output for scripting

All query commands support `--json` for structured output:

```bash
# Get session list as JSON
conclear sessions --json | jq '.[0].id'

# Search with JSON output
conclear search "database migration" --json | jq '.[] | .text'
```

## Install ConClear into your AI clients

```bash
# Detect and install for every supported client
conclear install

# Install for specific clients only
conclear install --claude-code --cursor

# Install for every supported client (even undetected ones), MCP only
conclear install --all --no-skill

# Check status afterward
conclear doctor

# Remove from a specific client
conclear uninstall --zed
```

## Start the MCP server over HTTP

```bash
# Streamable HTTP on default port 7331
conclear mcp --http

# Custom port
conclear mcp --http --port 8080
```
