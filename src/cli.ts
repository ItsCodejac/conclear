#!/usr/bin/env node

/**
 * ConClear CLI — unified entry point.
 *
 * Query commands (no server needed):
 *   conclear search <query> [--project <name>] [--limit <n>] [--json]
 *   conclear files <path-pattern> [--session <name-or-id>] [--latest] [--json]
 *   conclear sessions [--project <name>] [--limit <n>] [--json]
 *   conclear summary <session-name-or-id> [--json]
 *   conclear context <session-name-or-id> [--json]
 *
 * Install commands:
 *   conclear install [--all] [--<client-id>...] [--no-skill]
 *   conclear uninstall [--all] [--<client-id>...] [--no-skill]
 *   conclear doctor
 *
 * MCP server:
 *   conclear mcp [--http] [--port <n>]
 *
 * UI launcher (default):
 *   conclear          — starts the web UI
 *   conclear --ui     — starts the web UI
 */

const QUERY_COMMANDS = new Set(['search', 'files', 'sessions', 'summary', 'context', 'export', 'scan']);
const META_COMMANDS = new Set(['mcp', 'install', 'uninstall', 'doctor']);

function printHelp(): void {
  process.stdout.write(`ConClear - AI session explorer

QUERY COMMANDS (no server needed):
  conclear search <query> [--project <name>] [--limit <n>] [--json]
  conclear files <path-pattern> [--session <name-or-id>] [--latest] [--json]
  conclear sessions [--project <name>] [--limit <n>] [--json]
  conclear summary <session-name-or-id> [--json]
  conclear context <session-name-or-id> [--json]
  conclear export <session-name-or-id> [--output <file>] [--format md|txt]
  conclear scan <session-name-or-id> [--json]

INSTALL:
  conclear install         Install MCP server (+ skill where supported) into detected AI clients
  conclear install --all   Install for every supported client, even undetected
  conclear install --claude-code --cursor   Install only for specific clients
  conclear install --no-skill               Install MCP only, skip skills
  conclear uninstall [flags as above]
  conclear doctor          Show install status across all clients

MCP SERVER:
  conclear mcp                 Start the MCP server (stdio transport, for AI agents)
  conclear mcp --http          Start with Streamable HTTP transport
  conclear mcp --http --port 8080

UI LAUNCHER:
  conclear            Start the web UI
  conclear --ui       Start the web UI

FLAGS:
  --json              Output structured JSON (works on all query commands)
  --help, -h          Show this help
`);
}

/** Pluck --port N or --port=N from argv. */
function pickPort(args: string[]): number | undefined {
  const idx = args.indexOf('--port');
  if (idx >= 0 && args[idx + 1]) return Number(args[idx + 1]);
  const eq = args.find(a => a.startsWith('--port='));
  if (eq) return Number(eq.slice('--port='.length));
  return undefined;
}

/** Parse install/uninstall flags: --all, --no-skill, --<client-id>. */
function parseInstallFlags(args: string[]): { all: boolean; noSkill: boolean; only: string[] } {
  const all = args.includes('--all');
  const noSkill = args.includes('--no-skill');
  const only: string[] = [];
  for (const a of args) {
    if (a.startsWith('--') && a !== '--all' && a !== '--no-skill' && !a.startsWith('--port')) {
      only.push(a.slice(2));
    }
  }
  return { all, noSkill, only };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const command = args[0]?.toLowerCase();

  // Meta commands — MCP server + install lifecycle
  if (command && META_COMMANDS.has(command)) {
    if (command === 'mcp') {
      const { startMcpServer } = await import('./mcp-server.js');
      const http = args.includes('--http');
      const port = pickPort(args);
      await startMcpServer({ http, port });
      return;
    }
    if (command === 'install' || command === 'uninstall') {
      const flags = parseInstallFlags(args.slice(1));
      const { runInstall, runUninstall } = await import('./install/index.js');
      if (command === 'install') await runInstall(flags);
      else await runUninstall(flags);
      return;
    }
    if (command === 'doctor') {
      const { runDoctor } = await import('./install/index.js');
      await runDoctor();
      return;
    }
  }

  // Query commands — import handler module, run directly (no server)
  if (command && QUERY_COMMANDS.has(command)) {
    const { cmdSearch, cmdFiles, cmdSessions, cmdSummary, cmdContext, cmdExport, cmdScan } = await import('./cli-query.js');
    const cmdArgs = args.slice(1);

    switch (command) {
      case 'search':   await cmdSearch(cmdArgs); break;
      case 'files':    await cmdFiles(cmdArgs); break;
      case 'sessions': await cmdSessions(cmdArgs); break;
      case 'summary':  await cmdSummary(cmdArgs); break;
      case 'context':  await cmdContext(cmdArgs); break;
      case 'export':   await cmdExport(cmdArgs); break;
      case 'scan':     await cmdScan(cmdArgs); break;
    }
    return;
  }

  // Default: launch web UI
  process.env.NODE_ENV = 'production';
  const { startServer, PORT } = await import('./server/index.js');
  const { default: open } = await import('open');

  const url = `http://localhost:${PORT}`;
  console.log('Starting ConClear...');

  await startServer();
  console.log(`Opening ${url} in your browser...`);
  open(url);
}

main().catch(err => {
  process.stderr.write(`Error: ${err.message || err}\n`);
  process.exit(1);
});
