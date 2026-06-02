import { findAdapterFor, resolveSession } from '../server/adapters/registry.js';
import { getFlag, formatDate, formatBytes, truncate, decodeProjectDir } from './shared.js';

export async function cmdSummary(args: string[]): Promise<void> {
  const json = getFlag(args, '--json');
  const query = args.join(' ').trim();
  if (!query) {
    process.stderr.write('Usage: conclear summary <session-name-or-id> [--json]\n');
    process.exit(1);
  }

  const session = await resolveSession(query);
  if (!session) {
    process.stderr.write(`Session not found: ${query}\n`);
    process.exit(1);
  }
  const adapter = await findAdapterFor(session);
  if (!adapter) {
    process.stderr.write(`No adapter found for session ${session.id}\n`);
    process.exit(1);
  }

  const conversation = await adapter.getConversation(session.id);
  const userMsgs = conversation.messages
    .filter(m => m.role === 'user' && m.text.trim().length > 10)
    .slice(0, 5);

  let filesTouched: string[] = [];
  if (adapter.getFileHistory) {
    try {
      const histories = await adapter.getFileHistory(session.id);
      filesTouched = histories.map(h => h.filePath);
    } catch { /* fall through */ }
  }

  const summary = {
    id: session.id,
    name: session.name,
    preview: session.preview,
    project: decodeProjectDir(session.project),
    tool: session.tool,
    firstMessage: formatDate(session.createdAt),
    lastMessage: formatDate(session.lastActiveAt),
    messageCount: session.messageCount,
    imageCount: session.imageCount,
    size: formatBytes(session.totalSizeBytes),
    usage: session.usage,
    fileHistorySupported: typeof adapter.getFileHistory === 'function',
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
  process.stdout.write(`ID: ${session.id}  (${session.tool})\n`);
  process.stdout.write(`Project: ${summary.project}\n`);
  process.stdout.write(`First message: ${summary.firstMessage}\n`);
  process.stdout.write(`Last message: ${summary.lastMessage}\n`);
  process.stdout.write(`Messages: ${summary.messageCount}  Images: ${summary.imageCount}  Size: ${summary.size}\n`);
  if (session.usage) {
    const u = session.usage;
    const parts: string[] = [];
    if (u.tokensIn != null) parts.push(`in:${u.tokensIn}`);
    if (u.tokensOut != null) parts.push(`out:${u.tokensOut}`);
    if (u.cacheReads != null) parts.push(`cacheR:${u.cacheReads}`);
    if (u.cacheWrites != null) parts.push(`cacheW:${u.cacheWrites}`);
    if (u.totalCostUsd != null) parts.push(`$${u.totalCostUsd.toFixed(4)}`);
    if (parts.length) process.stdout.write(`Usage: ${parts.join('  ')}\n`);
  }
  if (!summary.fileHistorySupported) {
    process.stdout.write(`Files touched: (not yet supported for ${session.tool})\n`);
  } else {
    process.stdout.write(`Files touched: ${summary.filesTouched}\n`);
    if (filesTouched.length > 0) {
      process.stdout.write('\nFiles:\n');
      for (const f of filesTouched.slice(0, 20)) process.stdout.write(`  ${f}\n`);
      if (filesTouched.length > 20) process.stdout.write(`  ... and ${filesTouched.length - 20} more\n`);
    }
  }

  if (userMsgs.length > 0) {
    process.stdout.write('\nKey user messages:\n');
    for (const m of userMsgs) {
      process.stdout.write(`  [${formatDate(m.timestamp)}] ${truncate(m.text, 120)}\n`);
    }
  }
}
