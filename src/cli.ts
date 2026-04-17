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
 * UI launcher (default):
 *   conclear          — starts the web UI
 *   conclear --ui     — starts the web UI
 */

const QUERY_COMMANDS = new Set(['search', 'files', 'sessions', 'summary', 'context', 'export']);

function printHelp(): void {
  process.stdout.write(`ConClear - AI session explorer

QUERY COMMANDS (no server needed):
  conclear search <query> [--project <name>] [--limit <n>] [--json]
    Search across all sessions for matching messages

  conclear files <path-pattern> [--session <name-or-id>] [--latest] [--json]
    Find file versions matching a path pattern (e.g. "api.ts", "src/server/*")

  conclear sessions [--project <name>] [--limit <n>] [--json]
    List sessions, most recent first

  conclear summary <session-name-or-id> [--json]
    Quick summary of a session

  conclear context <session-name-or-id> [--json]
    Dump full conversation as clean text (user/assistant only)

  conclear export <session-name-or-id> [--output <file>] [--format md|txt]
    Export session as a clean markdown document

UI LAUNCHER:
  conclear            Start the web UI
  conclear --ui       Start the web UI

FLAGS:
  --json              Output structured JSON (works on all commands)
  --help, -h          Show this help
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const command = args[0]?.toLowerCase();

  // Query commands — import handler module, run directly (no server)
  if (command && QUERY_COMMANDS.has(command)) {
    const { cmdSearch, cmdFiles, cmdSessions, cmdSummary, cmdContext, cmdExport } = await import('./cli-query.js');
    const cmdArgs = args.slice(1);

    switch (command) {
      case 'search':   await cmdSearch(cmdArgs); break;
      case 'files':    await cmdFiles(cmdArgs); break;
      case 'sessions': await cmdSessions(cmdArgs); break;
      case 'summary':  await cmdSummary(cmdArgs); break;
      case 'context':  await cmdContext(cmdArgs); break;
      case 'export':   await cmdExport(cmdArgs); break;
    }
    return;
  }

  // Default: launch web UI
  const { startServer, PORT } = await import('./server/index.js');
  const { default: open } = await import('open');

  const url = `http://localhost:${PORT}`;
  process.env.NODE_ENV = 'production';
  console.log('Starting ConClear...');

  await startServer();
  console.log(`Opening ${url} in your browser...`);
  open(url);
}

main().catch(err => {
  process.stderr.write(`Error: ${err.message || err}\n`);
  process.exit(1);
});
