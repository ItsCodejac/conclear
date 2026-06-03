/**
 * Cline scan + redact tests. Cline's data is Anthropic-shaped (array of
 * messages with text / tool_use / tool_result blocks), so the same scanner
 * applies. These tests fixture the JSON directly so they don't need real
 * Cline data on disk.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanClineSecrets, redactClineSecrets } from '../../src/server/adapters/cline/parser.js';

function write(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

describe('Cline scan + redact', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'conclear-cline-redact-'));
    path = join(dir, 'api_conversation_history.json');
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('finds a secret in a text block', async () => {
    write(path, [
      { role: 'user', content: [{ type: 'text', text: 'here is my key sk-ant-abcdefghijklmnopqrstuv1234' }] },
    ]);
    const findings = await scanClineSecrets(path);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].type).toBe('api_key');
  });

  it('finds a secret inside a tool_use input', async () => {
    write(path, [
      { role: 'assistant', content: [
        { type: 'tool_use', id: 't1', name: 'bash', input: { command: 'export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789' } },
      ]},
    ]);
    const findings = await scanClineSecrets(path);
    expect(findings.some(f => f.type === 'github_token')).toBe(true);
  });

  it('redacts secrets in text + tool_use + tool_result', async () => {
    write(path, [
      { role: 'user', content: [{ type: 'text', text: 'key sk-ant-abcdefghijklmnopqrstuv1234' }] },
      { role: 'assistant', content: [
        { type: 'tool_use', id: 't1', name: 'bash', input: { command: 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456"' } },
        { type: 'tool_result', tool_use_id: 't1', content: 'AKIA' + 'IOSFODNN7EXAMPLE' },
      ]},
    ]);
    const r = await redactClineSecrets(path, null);
    expect(r.replaced).toBeGreaterThanOrEqual(3);

    const rewritten = JSON.parse(readFileSync(path, 'utf-8'));
    const allText = JSON.stringify(rewritten);
    expect(allText).not.toContain('sk-ant-abcdefghijklmnopqrstuv1234');
    expect(allText).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(allText).toContain('****REDACTED****');
  });

  it('line filter targets one message', async () => {
    write(path, [
      { role: 'user', content: [{ type: 'text', text: 'first sk-ant-aaaaaaaaaaaaaaaaaaaa1111' }] },
      { role: 'user', content: [{ type: 'text', text: 'second sk-ant-bbbbbbbbbbbbbbbbbbbb2222' }] },
    ]);
    const r = await redactClineSecrets(path, { lineNumber: 2 });
    expect(r.replaced).toBe(1);
    const rewritten = JSON.parse(readFileSync(path, 'utf-8'));
    expect(JSON.stringify(rewritten[0])).toContain('sk-ant-aaaaaaaaaaaaaaaaaaaa1111');
    expect(JSON.stringify(rewritten[1])).toContain('****REDACTED****');
  });

  it('preserves message structure (still valid JSON array)', async () => {
    write(path, [
      { role: 'user', content: [{ type: 'text', text: 'sk-ant-abcdefghijklmnopqrstuv1234' }] },
    ]);
    await redactClineSecrets(path, null);
    const rewritten = JSON.parse(readFileSync(path, 'utf-8'));
    expect(Array.isArray(rewritten)).toBe(true);
    expect(rewritten[0].role).toBe('user');
    expect(rewritten[0].content[0].type).toBe('text');
  });
});
