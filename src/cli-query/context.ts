import { findAdapterFor, resolveSession } from '../server/adapters/registry.js';
import type { Session } from '../server/adapters/types.js';
import { contextPage, readMessages, type ContextOptions } from '../server/context.js';
import { getFlag, getOption } from './shared.js';

export async function cmdContext(args: string[]): Promise<void> {
  const json = getFlag(args, '--json');
  const options: ContextOptions = {};
  for (const [flag, key] of [['--around', 'around'], ['--cursor', 'cursor']] as const) {
    if (args.includes(flag)) {
      const value = getOption(args, flag);
      if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
      options[key] = value;
    }
  }
  for (const [flag, key] of [['--before', 'before'], ['--after', 'after'], ['--limit', 'limit'], ['--max-chars', 'maxChars'], ['--offset', 'offset']] as const) {
    if (args.includes(flag)) {
      const value = getOption(args, flag);
      if (!value || !/^\d+$/.test(value)) throw new Error(`${flag} requires an integer`);
      options[key] = Number(value);
    }
  }
  const tool = getOption(args, '--tool');
  if (tool !== undefined && !['claude', 'gemini', 'cline', 'cursor', 'copilot'].includes(tool)) throw new Error('Unknown tool');
  if (args.some(a => a.startsWith('--'))) throw new Error('Unknown or incomplete context option');
  const query = args.join(' ').trim();
  if (!query) throw new Error('Usage: conclear context <session> [--around <ref> | --cursor <cursor>] [--limit N] [--max-chars N] [--json]');
  const session = await resolveSession(query, tool as Session['tool'] | undefined);
  if (!session) throw new Error(`Session not found: ${query}`);
  const adapter = await findAdapterFor(session);
  if (!adapter) throw new Error(`No adapter found for session ${session.id}`);
  const data = contextPage(session, await readMessages(adapter, session), options);
  if (json) {
    process.stdout.write(JSON.stringify(data) + '\n');
    return;
  }
  process.stdout.write(`# Session: ${session.id} (${session.tool})\n# ${data.scope}\n`);
  for (const m of data.messages) {
    process.stdout.write(`\n--- ${m.role.toUpperCase()} ${m.timestamp ?? ''} ---\nRef: ${m.messageRef}\n`);
    process.stdout.write(`Characters ${m.startOffset}–${m.endOffset} of ${m.totalChars}\n${m.text}\n`);
  }
  process.stdout.write(`\n# Complete conversation: ${data.page.complete}; earlier text: ${data.page.hasEarlier}; later text: ${data.page.hasLater}\n`);
  if (data.page.nextCursor) process.stdout.write(`# Continue: --cursor ${data.page.nextCursor}\n`);
  if (data.page.previousCursor) process.stdout.write(`# Earlier: --cursor ${data.page.previousCursor}\n`);
}
