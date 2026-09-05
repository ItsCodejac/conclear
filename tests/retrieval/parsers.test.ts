import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseConversation as claude } from '../../src/server/adapters/claude/parser.js';
import { parseConversation as cline } from '../../src/server/adapters/cline/parser.js';
import { parseConversation as gemini } from '../../src/server/adapters/gemini/parser.js';
import { parseConversation as copilot } from '../../src/server/adapters/copilot/parser.js';
import { parseConversation as cursor } from '../../src/server/adapters/cursor/parser.js';
import { referenceMessages, contextPage } from '../../src/server/context.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'conclear-retrieval-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
const text = 'preface '.repeat(500) + 'Correction: the guard invalidated the result.';
const fixtures = [
  { name: 'claude', parser: claude, data: { type: 'user', uuid: 'u1', message: { role: 'user', content: text } } },
  { name: 'cline', parser: cline, data: [{ role: 'user', content: [{ type: 'text', text }] }] },
  { name: 'gemini', parser: gemini, data: { sessionId: 's', messages: [{ id: 'u1', type: 'user', content: text }] } },
  { name: 'copilot', parser: copilot, data: { sessionId: 's', requests: [{ message: { text } }] } },
];

describe('full-text source retrieval', () => {
  for (const f of fixtures) {
    it(`${f.name}: retains the tail while preserving the UI preview default`, async () => {
      const path = join(dir, 'session.json');
      writeFileSync(path, JSON.stringify(f.data));
      expect((await f.parser(path)).messages[0].text).toHaveLength(2000);
      const full = await f.parser(path, { fullText: true });
      expect(full.messages[0].text).toBe(text);
      const scope = { id: 's', tool: f.name as 'claude' | 'cline' | 'gemini' | 'copilot' };
      const messages = referenceMessages(scope, full.messages);
      const page = contextPage(scope, messages, { around: messages[0].messageRef, before: 0, offset: text.indexOf('Correction') });
      expect(page.messages[0].text).toBe('Correction: the guard invalidated the result.');
    });
    it(`${f.name}: refuses to report corrupt content as complete`, async () => {
      const path = join(dir, 'broken');
      writeFileSync(path, '{broken');
      await expect(f.parser(path, { fullText: true })).rejects.toThrow();
    });
  }
  it('Claude: excludes tool results from retrieved conversation text', async () => {
    const path = join(dir, 'session.jsonl');
    writeFileSync(path, JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: [
      { type: 'tool_result', content: 'should not be retrieved' }, { type: 'text', text: 'actual user text' },
    ] } }));
    expect((await claude(path, { fullText: true })).messages[0].text).toBe('actual user text');
  });
  it('Cursor: references SQLite bubbles and preserves full text', () => {
    const path = join(dir, 'state.vscdb');
    const db = new DatabaseSync(path);
    db.exec('CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)');
    const insert = db.prepare('INSERT INTO cursorDiskKV VALUES (?, ?)');
    insert.run('composerData:s', JSON.stringify({ composerId: 's', fullConversationHeadersOnly: [{ bubbleId: 'b', type: 1 }] }));
    insert.run('bubbleId:s:b', JSON.stringify({ bubbleId: 'b', type: 1, text }));
    db.close();
    const messages = referenceMessages({ id: 's', tool: 'cursor' }, cursor(path, 's', { fullText: true }).messages);
    expect(messages[0].text).toBe(text);
    expect(messages[0].messageRef).toMatch(/^cc1:/);
    expect(() => cursor(path, 'missing', { fullText: true })).toThrow(/missing/);
  });
});

it('retains narrative alongside tool calls without including tool payloads', async () => {
  const blocks = [
    { type: 'text', text: 'The guard invalidated the optimistic result.' },
    { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'secret-payload.txt' } },
  ];
  for (const [name, parser, data] of [
    ['claude', claude, { type: 'assistant', uuid: 'm1', message: { role: 'assistant', content: blocks } }],
    ['cline', cline, [{ role: 'assistant', content: blocks }]],
  ] as const) {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(data));
    const full = referenceMessages({ id: 's', tool: name }, (await parser(path, { fullText: true })).messages);
    expect(full[0].text).toBe('The guard invalidated the optimistic result.');
    expect(full[0].toolUse).toBeUndefined();
    expect(JSON.stringify(full)).not.toContain('secret-payload');
  }
});
