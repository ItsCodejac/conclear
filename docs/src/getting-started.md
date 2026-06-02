# Getting Started

ConClear runs as a local Node.js application. It requires Node.js 22 or later.

There are three ways to use ConClear:

1. **Web UI** -- a visual session browser that runs a local server and opens in your browser.
2. **CLI** -- query commands that run directly without a server.
3. **MCP server** -- an stdio-based server that AI agents can use to query your session history.

ConClear auto-detects which AI tools you have installed by checking their standard data directories. No configuration is needed.

Once the CLI is installed, `conclear install` wires the MCP server (and Skill, where supported) into your AI clients automatically — see [Install into AI Clients](install.md).
