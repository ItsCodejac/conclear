/**
 * Regression test for the [object Object] — [object Object] bug in Copilot
 * session names. data.mode and data.selectedModel are typed as strings in
 * the parser but Copilot occasionally writes objects there.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSessionFile } from '../../src/server/adapters/copilot/parser.js';

function writeSession(dir: string, data: Record<string, unknown>): string {
  const p = join(dir, 'session.json');
  writeFileSync(p, JSON.stringify(data));
  return p;
}

describe('Copilot parser: session name coercion', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'conclear-copilot-test-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('joins string mode + string selectedModel cleanly', async () => {
    const p = writeSession(dir, {
      sessionId: 's1',
      mode: 'agent',
      selectedModel: 'claude-3.5',
      requests: [{ message: { text: 'hi' } }],
    });
    const session = await parseSessionFile(p);
    expect(session?.name).toBe('agent — claude-3.5');
  });

  it('skips object-valued mode/selectedModel instead of producing [object Object]', async () => {
    const p = writeSession(dir, {
      sessionId: 's2',
      mode: { type: 'agent', detail: 'whatever' }, // object — the bug
      selectedModel: { name: 'claude', version: 4 }, // also object
      requests: [{ message: { text: 'hi' } }],
    });
    const session = await parseSessionFile(p);
    expect(session?.name).toBeNull(); // name dropped because both inputs were objects
  });

  it('handles partial: string mode but object selectedModel', async () => {
    const p = writeSession(dir, {
      sessionId: 's3',
      mode: 'chat',
      selectedModel: { foo: 'bar' },
      requests: [{ message: { text: 'hi' } }],
    });
    const session = await parseSessionFile(p);
    expect(session?.name).toBe('chat');
  });

  it('handles missing mode and selectedModel', async () => {
    const p = writeSession(dir, {
      sessionId: 's4',
      requests: [{ message: { text: 'hi' } }],
    });
    const session = await parseSessionFile(p);
    expect(session?.name).toBeNull();
  });
});
