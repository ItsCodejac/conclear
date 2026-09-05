import { describe, it, expect } from 'vitest';
import { contextPage, referenceMessages, type ContextOptions } from '../../src/server/context.js';
import type { ChatMessage } from '../../src/server/adapters/types.js';

const session = { id: 'session', tool: 'claude' as const };
const message = (text: string, id = 'm'): ChatMessage => ({ id, role: 'assistant', text, hasImage: false });
const refs = (texts: string[]) => referenceMessages(session, texts.map((text, i) => message(text, `m${i}`)));

describe('bounded context', () => {
  it('keeps message references stable on append and rejects changed text', () => {
    const old = refs(['original', 'second']);
    expect(refs(['original', 'second', 'third'])[0].messageRef).toBe(old[0].messageRef);
    expect(() => contextPage(session, refs(['redacted', 'second']), { around: old[0].messageRef })).toThrow(/changed/);
    expect(referenceMessages({ ...session, tool: 'cursor' }, [message('original', 'm0')])[0].messageRef).not.toBe(old[0].messageRef);
  });
  it('does not collapse duplicate source IDs or repeated messages', () => {
    const result = referenceMessages(session, [message('same'), message('same'), message('different')]);
    expect(new Set(result.map(m => m.messageRef)).size).toBe(3);
  });
  it('defaults to the latest 20 messages and exposes earlier history', () => {
    const page = contextPage(session, refs(Array.from({ length: 30 }, (_, i) => `${i}`)));
    expect(page.messages[0].index).toBe(10);
    expect(page.page.complete).toBe(false);
    expect(page.page.hasEarlier).toBe(true);
    expect(page.page.hasLater).toBe(false);
    expect(page.page.previousCursor).toBeTruthy();
  });
  it('follows a promising claim through later corrections without repetition', () => {
    const messages = refs(['setup', 'pair_dip is profitable', 'tests pending', 'guard removes the profit', 'do not revive it', 'next topic']);
    const first = contextPage(session, messages, { around: messages[1].messageRef, before: 0, after: 1 });
    expect(first.messages.map(m => m.text)).toEqual(['pair_dip is profitable', 'tests pending']);
    expect(first.page.complete).toBe(false);
    const next = contextPage(session, messages, { cursor: first.page.nextCursor!, limit: 2 });
    expect(next.messages.map(m => m.text)).toEqual(['guard removes the profit', 'do not revive it']);
    expect(next.messages.some(m => first.messages.some(p => p.messageRef === m.messageRef))).toBe(false);
  });
  it('recovers every character of long messages within the shared budget', () => {
    const texts = ['a'.repeat(255) + '😀' + 'b'.repeat(503), 'correction'.repeat(90)];
    const messages = refs(texts);
    const recovered = ['', ''];
    let options: ContextOptions = { around: messages[0].messageRef, before: 0, after: 1, maxChars: 256 };
    let pages = 0;
    do {
      const page = contextPage(session, messages, options);
      expect(page.page.textChars).toBeLessThanOrEqual(256);
      expect(() => JSON.parse(JSON.stringify(page))).not.toThrow();
      for (const m of page.messages) {
        expect(m.startOffset).toBe(recovered[m.index].length);
        recovered[m.index] += m.text;
        expect(/[\uD800-\uDBFF]$/.test(m.text)).toBe(false);
      }
      pages++;
      if (!page.page.nextCursor) break;
      options = { cursor: page.page.nextCursor, maxChars: 256 };
    } while (pages < 20);
    expect(recovered).toEqual(texts);
    expect(pages).toBeLessThan(20);
  });
  it('reaches deep search hits directly using their offset', () => {
    const messages = refs(['x'.repeat(20000) + 'decisive correction']);
    const page = contextPage(session, messages, { around: messages[0].messageRef, before: 0, after: 0, offset: 20000 });
    expect(page.messages[0].text).toBe('decisive correction');
    expect(page.page.omittedPrefixChars).toBe(20000);
    expect(page.page.complete).toBe(false);
  });
  it('rejects stale cursors and cursors from another tool', () => {
    const messages = refs(['a', 'b', 'c']);
    const cursor = contextPage(session, messages, { around: messages[0].messageRef, before: 0, after: 0 }).page.nextCursor!;
    expect(() => contextPage(session, refs(['a', 'b', 'c', 'd']), { cursor })).toThrow(/changed/);
    expect(() => contextPage({ ...session, tool: 'gemini' }, messages, { cursor })).toThrow(/Invalid/);
  });
  it('returns an honest empty page and excludes non-conversation messages', () => {
    const messages = referenceMessages(session, [
      { ...message('system'), role: 'system' },
      { ...message('tool'), toolUse: 'Read' },
      { ...message('tool'), toolCall: { name: 'Read' } }, message('   '),
    ]);
    const page = contextPage(session, messages);
    expect(page.messages).toEqual([]);
    expect(page.page.complete).toBe(true);
    expect(page.page.nextCursor).toBeNull();
  });
  it.each([
    { cursor: 'bad' }, { before: 3 }, { limit: 0 }, { maxChars: 100000 },
    { limit: NaN }, { offset: 2 }, { around: 'bad', cursor: 'bad' },
  ])('rejects invalid options %j', options => {
    expect(() => contextPage(session, refs(['a']), options)).toThrow();
  });
});
