import { describe, it, expect } from 'vitest';
import type { Adapter, Session } from '../../src/server/adapters/types.js';
import { searchConversations } from '../../src/server/search.js';
import { readMessages, contextPage } from '../../src/server/context.js';

const session = (id: string, project = 'project'): Session => ({ id, project, tool: 'claude', name: id, preview: null, createdAt: 0, lastActiveAt: 1, messageCount: 1, imageCount: 0, totalSizeBytes: 0, imageSizeBytes: 0, filePath: 'unused', hasOversizedImages: false, maxImageDimension: 0 });
function adapter(sessions: Session[], texts: Record<string, string[]>): Adapter {
  return {
    name: 'test', detect: async () => true, listSessions: async () => sessions,
    getConversation: async (id: string, options?: { fullText?: boolean }) => {
      expect(options?.fullText).toBe(true);
      if (!texts[id]) throw new Error('unreadable');
      return { timeline: [], messages: texts[id].map((text, i) => ({ id: String(i), text, role: 'assistant' as const, hasImage: false, timestamp: new Date(i * 1000).toISOString() })) };
    },
  } as Adapter;
}

describe('search to context', () => {
  it('resolves a deep search hit to original text and later evidence', async () => {
    const s = session('one');
    const a = adapter([s], { one: ['x'.repeat(3000) + 'pair_dip profitable', 'guard removes the profit'] });
    const search = await searchConversations('pair_dip', 10, undefined, [a]);
    const hit = search.matches[0];
    expect(hit.matchOffset).toBe(3000);
    const page = contextPage(s, await readMessages(a, s), { around: hit.messageRef, before: 0, offset: hit.matchOffset });
    expect(page.messages.map(m => m.text)).toEqual(['pair_dip profitable', 'guard removes the profit']);
    expect(search.coverage.complete).toBe(true);
  });
  it('filters projects before limits and reports omitted matches', async () => {
    const a = adapter([session('one', 'wrong'), session('two', 'right')], { one: ['hit'], two: ['hit 1', 'hit 2', 'hit 3'] });
    const result = await searchConversations('hit', 1, 'right', [a]);
    expect(result.matches[0].text).toBe('hit 3');
    expect(result.coverage).toMatchObject({ searchedSessions: 1, matchedMessages: 3, omittedMatches: 2, complete: false });
  });
  it('makes failed sources visible while retaining successful results', async () => {
    const a = adapter([session('bad'), session('good')], { good: ['hit'] });
    const result = await searchConversations('hit', 10, undefined, [a]);
    expect(result.matches).toHaveLength(1);
    expect(result.coverage.failedSourceCount).toBe(1);
    expect(result.coverage.complete).toBe(false);
  });
});

describe('retrieval size regression', () => {
  it('retrieves the claim and correction using much less text than the full session', async () => {
    const s = session('long');
    const history = Array.from({ length: 100 }, (_, i) => `Unrelated discussion ${i}: ` + 'detail '.repeat(300));
    history[30] = 'pair_dip appears profitable';
    history[31] = 'The block-opening guard removes the profit; the earlier result was misleading.';
    const a = adapter([s], { long: history });
    const search = await searchConversations('pair_dip', 5, undefined, [a]);
    const page = contextPage(s, await readMessages(a, s), { around: search.matches[0].messageRef, before: 0, after: 1 });
    const deliveredChars = JSON.stringify(search).length + JSON.stringify(page).length;
    expect(page.messages[1].text).toContain('earlier result was misleading');
    expect(page.page.complete).toBe(false);
    expect(deliveredChars).toBeLessThan(JSON.stringify(history).length / 10);
  });
});
