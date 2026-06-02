import { findAdapterFor, resolveSession } from '../server/adapters/registry.js';
import { getFlag, formatDate } from './shared.js';

export async function cmdContext(args: string[]): Promise<void> {
  const json = getFlag(args, '--json');
  const query = args.join(' ').trim();
  if (!query) {
    process.stderr.write('Usage: conclear context <session-name-or-id> [--json]\n');
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
  const messages = conversation.messages.filter(m =>
    (m.role === 'user' || m.role === 'assistant') && m.text.trim().length > 0 && !m.toolUse && !m.toolCall
  );

  if (json) {
    const data = messages.map(m => ({ role: m.role, timestamp: m.timestamp, text: m.text }));
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }

  process.stdout.write(`# Session: ${session.name || session.preview || session.id}\n`);
  process.stdout.write(`# ${formatDate(session.createdAt)} - ${formatDate(session.lastActiveAt)}  (${session.tool})\n`);
  process.stdout.write(`# ${session.messageCount} messages\n\n`);
  for (const m of messages) {
    const prefix = m.role === 'user' ? 'USER' : 'ASSISTANT';
    const ts = m.timestamp ? ` [${formatDate(m.timestamp)}]` : '';
    process.stdout.write(`--- ${prefix}${ts} ---\n`);
    process.stdout.write(m.text + '\n\n');
  }
}
