/**
 * ConClear CLI query commands — standalone, no server needed.
 * Imported by cli.ts when a query command is dispatched.
 */

import { ClaudeAdapter } from './server/adapters/claude/index.js';
import { parseConversation, parseFileHistory, getFileContent } from './server/adapters/claude/parser.js';
import type { Session } from './server/adapters/types.js';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

// ── Arg parsing helpers (zero deps) ──────────────────────────────────────────

export function getFlag(args: string[], name: string): boolean {
  const idx = args.indexOf(name);
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

export function getOption(args: string[], name: string, defaultValue?: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return defaultValue;
  if (idx + 1 >= args.length) return defaultValue;
  const val = args[idx + 1];
  args.splice(idx, 2);
  return val;
}

// ── Output helpers ───────────────────────────────────────────────────────────

function formatDate(ts: number | string | undefined): string {
  if (!ts) return '-';
  const d = new Date(typeof ts === 'string' ? ts : ts);
  if (isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + '...';
}

function decodeProjectDir(encoded: string): string {
  // Claude stores project dirs as e.g. "-Volumes-4tbCache--Projects-ConClear"
  // Return the last meaningful segment for readability
  const parts = encoded.split('-').filter(Boolean);
  return parts[parts.length - 1] || encoded;
}

// ── Session resolution: supports UUID, partial UUID, name, partial name ──────

async function resolveSession(adapter: ClaudeAdapter, query: string): Promise<Session | null> {
  const sessions = await adapter.listSessions();
  const q = query.toLowerCase();

  // Exact ID match
  let match = sessions.find(s => s.id === query);
  if (match) return match;

  // Partial ID match (prefix)
  const idMatches = sessions.filter(s => s.id.toLowerCase().startsWith(q));
  if (idMatches.length === 1) return idMatches[0];

  // Exact name match (case insensitive)
  match = sessions.find(s => s.name?.toLowerCase() === q);
  if (match) return match;

  // Partial name match
  const nameMatches = sessions.filter(s => s.name?.toLowerCase().includes(q));
  if (nameMatches.length === 1) return nameMatches[0];

  // Preview match as fallback
  const previewMatches = sessions.filter(s => s.preview?.toLowerCase().includes(q));
  if (previewMatches.length === 1) return previewMatches[0];

  // Multiple matches — return the most recent
  const all = [...idMatches, ...nameMatches, ...previewMatches];
  if (all.length > 0) {
    const seen = new Set<string>();
    const deduped: Session[] = [];
    for (const s of all) {
      if (!seen.has(s.id)) { seen.add(s.id); deduped.push(s); }
    }
    deduped.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    return deduped[0];
  }

  return null;
}

// ── Commands ─────────────────────────────────────────────────────────────────

export async function cmdSearch(args: string[]): Promise<void> {
  const json = getFlag(args, '--json');
  const projectFilter = getOption(args, '--project');
  const limitStr = getOption(args, '--limit', '10');
  const limit = parseInt(limitStr!, 10) || 10;

  const query = args.join(' ').trim();
  if (!query) {
    process.stderr.write('Usage: conclear search <query> [--project <name>] [--limit <n>] [--json]\n');
    process.exit(1);
  }

  const adapter = new ClaudeAdapter();
  const sessions = await adapter.listSessions();
  const queryLower = query.toLowerCase();

  interface SearchResult {
    sessionId: string;
    sessionName: string | null;
    project: string;
    timestamp: string | undefined;
    role: string;
    text: string;
  }

  const results: SearchResult[] = [];

  for (const session of sessions) {
    if (projectFilter && !session.project.toLowerCase().includes(projectFilter.toLowerCase())) continue;
    if (results.length >= limit) break;

    const rl = createInterface({
      input: createReadStream(session.filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (results.length >= limit) { rl.close(); break; }
      if (!line.trim()) continue;
      if (!line.toLowerCase().includes(queryLower)) continue;

      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const type = parsed.type as string;
        if (type !== 'user' && type !== 'assistant') continue;

        const message = parsed.message as Record<string, unknown> | undefined;
        if (!message) continue;

        const role = (message.role as string) || type;
        const content = message.content;
        let text = '';

        if (typeof content === 'string') {
          text = content;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block === 'object' && block !== null && (block as Record<string, unknown>).type === 'text') {
              text += (text ? '\n' : '') + ((block as Record<string, unknown>).text as string || '');
            }
          }
        }

        if (!text.toLowerCase().includes(queryLower)) continue;

        // Extract a window around the match
        const matchIdx = text.toLowerCase().indexOf(queryLower);
        const start = Math.max(0, matchIdx - 60);
        const end = Math.min(text.length, matchIdx + query.length + 60);
        let snippet = text.slice(start, end).replace(/\n/g, ' ').trim();
        if (start > 0) snippet = '...' + snippet;
        if (end < text.length) snippet = snippet + '...';

        results.push({
          sessionId: session.id,
          sessionName: session.name || session.preview,
          project: session.project,
          timestamp: parsed.timestamp as string | undefined,
          role,
          text: snippet,
        });
      } catch {
        // skip
      }
    }
  }

  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    return;
  }

  if (results.length === 0) {
    process.stdout.write(`No results for "${query}"\n`);
    return;
  }

  process.stdout.write(`Found ${results.length} result(s) for "${query}":\n\n`);
  for (const r of results) {
    const name = r.sessionName ? truncate(r.sessionName, 40) : r.sessionId.slice(0, 12);
    const ts = formatDate(r.timestamp);
    process.stdout.write(`[${ts}] ${name} (${r.role})\n  ${r.text}\n\n`);
  }
}

export async function cmdFiles(args: string[]): Promise<void> {
  const json = getFlag(args, '--json');
  const latest = getFlag(args, '--latest');
  const sessionQuery = getOption(args, '--session');
  const limitStr = getOption(args, '--limit');
  const limit = limitStr ? parseInt(limitStr, 10) : undefined;

  const pathPattern = args.join(' ').trim();
  if (!pathPattern) {
    process.stderr.write('Usage: conclear files <path-pattern> [--session <name-or-id>] [--latest] [--json]\n');
    process.exit(1);
  }

  const adapter = new ClaudeAdapter();

  // Build a regex from the path pattern (supports * and ** globs)
  const escaped = pathPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__DOUBLESTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DOUBLESTAR__/g, '.*');
  const pathRegex = new RegExp(escaped, 'i');

  interface FileResult {
    sessionId: string;
    sessionName: string | null;
    filePath: string;
    versionCount: number;
    lastModified: string | undefined;
    latestContent?: string;
  }

  const results: FileResult[] = [];

  async function searchSession(session: Session): Promise<void> {
    const histories = await parseFileHistory(session.filePath);
    for (const h of histories) {
      if (!pathRegex.test(h.filePath)) continue;

      const lastVersion = h.versions[h.versions.length - 1];
      const result: FileResult = {
        sessionId: session.id,
        sessionName: session.name || session.preview,
        filePath: h.filePath,
        versionCount: h.versions.length,
        lastModified: lastVersion?.timestamp,
      };

      if (latest && lastVersion) {
        const content = await getFileContent(session.filePath, lastVersion.lineNumber);
        if (content) result.latestContent = content;
      }

      results.push(result);
    }
  }

  if (sessionQuery) {
    const session = await resolveSession(adapter, sessionQuery);
    if (!session) {
      process.stderr.write(`Session not found: ${sessionQuery}\n`);
      process.exit(1);
    }
    await searchSession(session);
  } else {
    const sessions = await adapter.listSessions();
    for (const session of sessions) {
      await searchSession(session);
    }
  }

  // Sort: most versions first, then most recent
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

  // If --latest with a single result, dump content for piping
  if (latest && results.length === 1 && results[0].latestContent) {
    process.stdout.write(results[0].latestContent);
    if (!results[0].latestContent.endsWith('\n')) process.stdout.write('\n');
    return;
  }

  process.stdout.write(`Found ${results.length} file(s) matching "${pathPattern}":\n\n`);
  for (const r of results) {
    const name = r.sessionName ? truncate(r.sessionName, 30) : r.sessionId.slice(0, 12);
    const ts = formatDate(r.lastModified);
    process.stdout.write(`${r.filePath}\n  session: ${name}  versions: ${r.versionCount}  last: ${ts}\n`);
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

export async function cmdSessions(args: string[]): Promise<void> {
  const json = getFlag(args, '--json');
  const projectFilter = getOption(args, '--project');
  const limitStr = getOption(args, '--limit', '20');
  const limit = parseInt(limitStr!, 10) || 20;

  const adapter = new ClaudeAdapter();
  let sessions = await adapter.listSessions();

  if (projectFilter) {
    const pLower = projectFilter.toLowerCase();
    sessions = sessions.filter(s => s.project.toLowerCase().includes(pLower));
  }

  sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  sessions = sessions.slice(0, limit);

  if (json) {
    const data = sessions.map(s => ({
      id: s.id,
      name: s.name,
      preview: s.preview,
      project: s.project,
      lastActive: new Date(s.lastActiveAt).toISOString(),
      messageCount: s.messageCount,
      imageCount: s.imageCount,
      size: s.totalSizeBytes,
    }));
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }

  if (sessions.length === 0) {
    process.stdout.write('No sessions found.\n');
    return;
  }

  const header = padRow('NAME', 'PROJECT', 'LAST ACTIVE', 'MSGS', 'IMGS', 'SIZE');
  process.stdout.write(header + '\n');
  process.stdout.write('-'.repeat(header.length) + '\n');

  for (const s of sessions) {
    const name = truncate(s.name || s.preview || s.id.slice(0, 12), 36);
    const project = truncate(decodeProjectDir(s.project), 20);
    const lastActive = formatDate(s.lastActiveAt);
    const msgs = String(s.messageCount);
    const imgs = String(s.imageCount);
    const size = formatBytes(s.totalSizeBytes);
    process.stdout.write(padRow(name, project, lastActive, msgs, imgs, size) + '\n');
  }
}

function padRow(name: string, project: string, lastActive: string, msgs: string, imgs: string, size: string): string {
  return `${name.padEnd(38)} ${project.padEnd(22)} ${lastActive.padEnd(18)} ${msgs.padStart(5)} ${imgs.padStart(5)} ${size.padStart(8)}`;
}

export async function cmdSummary(args: string[]): Promise<void> {
  const json = getFlag(args, '--json');
  const query = args.join(' ').trim();
  if (!query) {
    process.stderr.write('Usage: conclear summary <session-name-or-id> [--json]\n');
    process.exit(1);
  }

  const adapter = new ClaudeAdapter();
  const session = await resolveSession(adapter, query);
  if (!session) {
    process.stderr.write(`Session not found: ${query}\n`);
    process.exit(1);
  }

  const conversation = await parseConversation(session.filePath);
  const fileHistories = await parseFileHistory(session.filePath);

  const userMsgs = conversation.messages
    .filter(m => m.role === 'user' && m.text.trim().length > 10)
    .slice(0, 5);

  const filesTouched = fileHistories.map(h => h.filePath);

  const summary = {
    id: session.id,
    name: session.name,
    preview: session.preview,
    project: decodeProjectDir(session.project),
    firstMessage: formatDate(session.createdAt),
    lastMessage: formatDate(session.lastActiveAt),
    messageCount: session.messageCount,
    imageCount: session.imageCount,
    size: formatBytes(session.totalSizeBytes),
    filesTouched: filesTouched.length,
    files: filesTouched.slice(0, 20),
    keyMessages: userMsgs.map(m => ({
      timestamp: formatDate(m.timestamp),
      text: truncate(m.text, 120),
    })),
  };

  if (json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    return;
  }

  process.stdout.write(`Session: ${session.name || session.preview || session.id}\n`);
  process.stdout.write(`ID: ${session.id}\n`);
  process.stdout.write(`Project: ${summary.project}\n`);
  process.stdout.write(`First message: ${summary.firstMessage}\n`);
  process.stdout.write(`Last message: ${summary.lastMessage}\n`);
  process.stdout.write(`Messages: ${summary.messageCount}  Images: ${summary.imageCount}  Size: ${summary.size}\n`);
  process.stdout.write(`Files touched: ${summary.filesTouched}\n`);

  if (filesTouched.length > 0) {
    process.stdout.write('\nFiles:\n');
    for (const f of filesTouched.slice(0, 20)) {
      process.stdout.write(`  ${f}\n`);
    }
    if (filesTouched.length > 20) {
      process.stdout.write(`  ... and ${filesTouched.length - 20} more\n`);
    }
  }

  if (userMsgs.length > 0) {
    process.stdout.write('\nKey user messages:\n');
    for (const m of userMsgs) {
      const ts = formatDate(m.timestamp);
      process.stdout.write(`  [${ts}] ${truncate(m.text, 120)}\n`);
    }
  }
}

export async function cmdContext(args: string[]): Promise<void> {
  const json = getFlag(args, '--json');
  const query = args.join(' ').trim();
  if (!query) {
    process.stderr.write('Usage: conclear context <session-name-or-id> [--json]\n');
    process.exit(1);
  }

  const adapter = new ClaudeAdapter();
  const session = await resolveSession(adapter, query);
  if (!session) {
    process.stderr.write(`Session not found: ${query}\n`);
    process.exit(1);
  }

  const conversation = await parseConversation(session.filePath);

  // Filter to user/assistant text only — no tool results noise
  const messages = conversation.messages.filter(m =>
    (m.role === 'user' || m.role === 'assistant') && m.text.trim().length > 0 && !m.toolUse
  );

  if (json) {
    const data = messages.map(m => ({
      role: m.role,
      timestamp: m.timestamp,
      text: m.text,
    }));
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }

  process.stdout.write(`# Session: ${session.name || session.preview || session.id}\n`);
  process.stdout.write(`# ${formatDate(session.createdAt)} - ${formatDate(session.lastActiveAt)}\n`);
  process.stdout.write(`# ${session.messageCount} messages\n\n`);

  for (const m of messages) {
    const prefix = m.role === 'user' ? 'USER' : 'ASSISTANT';
    const ts = m.timestamp ? ` [${formatDate(m.timestamp)}]` : '';
    process.stdout.write(`--- ${prefix}${ts} ---\n`);
    process.stdout.write(m.text + '\n\n');
  }
}
