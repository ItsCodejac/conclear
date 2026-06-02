import { listAllSessions, findAdapterFor, resolveSession } from '../server/adapters/registry.js';
import type { Session, FileHistory } from '../server/adapters/types.js';
import { getFlag, getOption, formatDate, truncate } from './shared.js';

interface FileResult {
  sessionId: string;
  sessionName: string | null;
  tool: string;
  filePath: string;
  versionCount: number;
  lastModified: string | undefined;
  latestContent?: string;
}

export async function cmdFiles(args: string[]): Promise<void> {
  const json = getFlag(args, '--json');
  const latest = getFlag(args, '--latest');
  const sessionQuery = getOption(args, '--session');

  const pathPattern = args.join(' ').trim();
  if (!pathPattern) {
    process.stderr.write('Usage: conclear files <path-pattern> [--session <name-or-id>] [--latest] [--json]\n');
    process.exit(1);
  }

  // Glob → regex
  const escaped = pathPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__DOUBLESTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DOUBLESTAR__/g, '.*');
  const pathRegex = new RegExp(escaped, 'i');

  const results: FileResult[] = [];

  async function searchSession(session: Session): Promise<void> {
    const adapter = await findAdapterFor(session);
    if (!adapter?.getFileHistory) return; // adapter doesn't support file history
    let histories: FileHistory[];
    try {
      histories = await adapter.getFileHistory(session.id);
    } catch {
      return;
    }
    for (const h of histories) {
      if (!pathRegex.test(h.filePath)) continue;

      const lastVersion = h.versions[h.versions.length - 1];
      const result: FileResult = {
        sessionId: session.id,
        sessionName: session.name || session.preview,
        tool: session.tool,
        filePath: h.filePath,
        versionCount: h.versions.length,
        lastModified: lastVersion?.timestamp,
      };

      if (latest && lastVersion && adapter.getFileContent) {
        const content = await adapter.getFileContent(session.id, lastVersion.lineNumber);
        if (content) result.latestContent = content;
      }

      results.push(result);
    }
  }

  if (sessionQuery) {
    const session = await resolveSession(sessionQuery);
    if (!session) {
      process.stderr.write(`Session not found: ${sessionQuery}\n`);
      process.exit(1);
    }
    await searchSession(session);
  } else {
    const sessions = await listAllSessions();
    for (const session of sessions) {
      await searchSession(session);
    }
  }

  results.sort((a, b) => {
    if (b.versionCount !== a.versionCount) return b.versionCount - a.versionCount;
    const aTs = a.lastModified ? new Date(a.lastModified).getTime() : 0;
    const bTs = b.lastModified ? new Date(b.lastModified).getTime() : 0;
    return bTs - aTs;
  });

  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    return;
  }

  if (results.length === 0) {
    process.stdout.write(`No files matching "${pathPattern}"\n`);
    return;
  }

  // If --latest with a single result, dump content for piping.
  if (latest && results.length === 1 && results[0].latestContent) {
    process.stdout.write(results[0].latestContent);
    if (!results[0].latestContent.endsWith('\n')) process.stdout.write('\n');
    return;
  }

  process.stdout.write(`Found ${results.length} file(s) matching "${pathPattern}":\n\n`);
  for (const r of results) {
    const name = r.sessionName ? truncate(r.sessionName, 30) : r.sessionId.slice(0, 12);
    process.stdout.write(`${r.filePath}\n  session: ${name}  (${r.tool})  versions: ${r.versionCount}  last: ${formatDate(r.lastModified)}\n`);
    if (latest && r.latestContent) {
      process.stdout.write('  ---\n');
      const lines = r.latestContent.split('\n');
      const preview = lines.slice(0, 20).map(l => '  ' + l).join('\n');
      process.stdout.write(preview + '\n');
      if (lines.length > 20) process.stdout.write(`  ... (${lines.length - 20} more lines)\n`);
      process.stdout.write('  ---\n');
    }
    process.stdout.write('\n');
  }
}
