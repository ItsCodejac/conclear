import { createHash } from 'node:crypto';
import type { Adapter, ChatMessage, Session } from './adapters/types.js';

export interface ContextOptions {
  around?: string;
  before?: number;
  after?: number;
  cursor?: string;
  limit?: number;
  maxChars?: number;
  offset?: number;
}

type Scope = Pick<Session, 'id' | 'tool'>;
type Position = { index: number; offset: number };
type Cursor = { scope: string; revision: string; position: Position; end: number };
export type ReferencedMessage = ChatMessage & { messageRef: string };

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const scopeOf = (session: Scope) => hash(JSON.stringify([session.tool, session.id])).slice(0, 24);
const encode = (value: Cursor) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** References survive append-only growth; changed text/identity requires a fresh search. */
export function referenceMessages(session: Scope, messages: ChatMessage[]): ReferencedMessage[] {
  const occurrences = new Map<string, number>();
  const scope = scopeOf(session);
  return messages.filter(m => (m.role === 'user' || m.role === 'assistant') &&
    m.text?.trim() && !m.toolUse && !m.toolCall).map(m => {
    const digest = hash(JSON.stringify([m.id, m.role, m.timestamp, m.text]));
    const occurrence = occurrences.get(digest) ?? 0;
    occurrences.set(digest, occurrence + 1);
    return { ...m, messageRef: `cc1:${scope}:${digest}:${occurrence}` };
  });
}

export async function readMessages(adapter: Adapter, session: Scope): Promise<ReferencedMessage[]> {
  const conversation = await adapter.getConversation(session.id, { fullText: true });
  return referenceMessages(session, conversation.messages);
}

function integer(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return n;
}

/** Text budgets use UTF-16 characters (JS string offsets), excluding bounded JSON metadata. */
export function contextPage(session: Scope, messages: ReferencedMessage[], options: ContextOptions = {}) {
  const limit = integer(options.limit, 20, 1, 50, 'limit');
  const maxChars = integer(options.maxChars, 12000, 256, 50000, 'maxChars');
  const before = integer(options.before, 3, 0, 20, 'before');
  const after = integer(options.after, 6, 0, 20, 'after');
  if (options.cursor && options.around) throw new Error('Use cursor or around, not both');
  if (!options.around && (options.before !== undefined || options.after !== undefined)) {
    throw new Error('before and after require around');
  }
  if (options.offset !== undefined && (!options.around || before !== 0)) {
    throw new Error('offset requires around and before=0');
  }
  const scope = scopeOf(session);
  const revision = hash(messages.map(m => m.messageRef).join('\n'));
  let start: Position = { index: Math.max(0, messages.length - limit), offset: 0 };
  let end = messages.length;
  let anchor: number | null = null;
  if (options.around) {
    anchor = messages.findIndex(m => m.messageRef === options.around);
    if (anchor < 0) throw new Error('Message reference not found or changed. Search again for a current reference.');
    start = { index: Math.max(0, anchor - before), offset: 0 };
    if (options.offset !== undefined) start.offset = integer(options.offset, 0, 0, messages[anchor].text.length - 1, 'offset');
    end = Math.min(messages.length, anchor + after + 1);
  }
  if (options.cursor) {
    let c: Cursor;
    try {
      if (options.cursor.length > 2048) throw new Error();
      c = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8'));
      if (!c || c.scope !== scope || !c.position ||
        !Number.isInteger(c.position.index) || !Number.isInteger(c.position.offset) || !Number.isInteger(c.end) ||
        c.position.index < 0 || c.position.index >= messages.length || c.position.offset < 0 ||
        c.position.offset >= messages[c.position.index].text.length ||
        c.end <= c.position.index || c.end > messages.length) throw new Error();
    } catch { throw new Error('Invalid context cursor for this session'); }
    if (c.revision !== revision) throw new Error('Conversation changed since this cursor was issued. Restart from a message reference or request fresh context.');
    start = c.position;
    end = c.end;
  }

  const output = [];
  let position = { ...start };
  let used = 0;
  while (position.index < end && output.length < limit && used < maxChars) {
    const m = messages[position.index];
    let stop = Math.min(m.text.length, position.offset + maxChars - used);
    // Never split a surrogate pair between pages.
    if (stop < m.text.length && /[\uD800-\uDBFF]/.test(m.text[stop - 1])) stop--;
    if (stop === position.offset) break;
    const text = m.text.slice(position.offset, stop);
    output.push({ messageRef: m.messageRef, index: position.index, role: m.role,
      timestamp: m.timestamp, text, startOffset: position.offset, endOffset: stop,
      totalChars: m.text.length, partial: position.offset > 0 || stop < m.text.length });
    used += text.length;
    position = stop === m.text.length ? { index: position.index + 1, offset: 0 } : { index: position.index, offset: stop };
  }
  const cursor = (p: Position, stop: number) => encode({ scope, revision, position: p, end: stop });
  const hasEarlier = start.index > 0 || start.offset > 0;
  const hasLater = position.index < messages.length;
  const windowComplete = position.index >= end;
  return {
    sessionId: session.id, tool: session.tool, revision,
    scope: 'Parsed user/assistant text; excludes tool calls, tool results, system messages, and images.',
    messages: output,
    page: {
      totalMessages: messages.length, start, end: position,
      textChars: used, maxChars, limit, windowComplete,
      complete: !hasEarlier && !hasLater,
      hasEarlier, hasLater,
      anchorIncluded: anchor === null ? null : output.some(m => m.index === anchor),
      nextCursor: hasLater ? cursor(position, windowComplete ? messages.length : end) : null,
      previousCursor: start.index > 0 ? cursor({ index: Math.max(0, start.index - limit), offset: 0 }, start.index) : null,
      // For a continuation inside a long message, the exact omitted prefix is accessible by its reference.
      omittedPrefixChars: start.offset,
      continuation: 'Pass nextCursor or previousCursor as cursor with the same session/tool. nextCursor resumes at the first unread character. Use around with before=0, after=0 to reopen a message.',
    },
  };
}
