/**
 * Gemini scan + redact tests. Gemini's chat file is a JSON object with a
 * messages[] array; content can be a string, a { text } object, or a parts[]
 * array. We exercise all three.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanGeminiSecrets, redactGeminiSecrets } from '../../src/server/adapters/gemini/parser.js';

function write(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

describe('Gemini scan + redact', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'conclear-gemini-redact-'));
    path = join(dir, 'session.json');
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('finds secrets in string content', async () => {
    write(path, {
      sessionId: 'gem-1',
      messages: [
        { id: 'm1', timestamp: 't', type: 'user', content: 'export AWS=AKIAIOSFODNN7EXAMPLE' },
      ],
    });
    const findings = await scanGeminiSecrets(path);
    expect(findings.some(f => f.type === 'aws_key')).toBe(true);
  });

  it('finds secrets in { text } object content', async () => {
    write(path, {
      sessionId: 'gem-2',
      messages: [
        { id: 'm1', timestamp: 't', type: 'user', content: { text: 'sk-ant-abcdefghijklmnopqrstuv1234' } },
      ],
    });
    const findings = await scanGeminiSecrets(path);
    expect(findings.some(f => f.type === 'api_key')).toBe(true);
  });

  it('finds secrets inside parts[]', async () => {
    write(path, {
      sessionId: 'gem-3',
      messages: [
        { id: 'm1', timestamp: 't', type: 'gemini', content: {
          parts: [{ text: 'response with ghp_abcdefghijklmnopqrstuvwxyz0123456789' }],
        }},
      ],
    });
    const findings = await scanGeminiSecrets(path);
    expect(findings.some(f => f.type === 'github_token')).toBe(true);
  });

  it('redacts across content shapes', async () => {
    write(path, {
      sessionId: 'gem-4',
      messages: [
        { id: 'm1', timestamp: 't', type: 'user',   content: 'key sk-ant-abcdefghijklmnopqrstuv1234' },
        { id: 'm2', timestamp: 't', type: 'gemini', content: { text: 'AKIA' + 'IOSFODNN7EXAMPLE' } },
        { id: 'm3', timestamp: 't', type: 'user',   content: { parts: [{ text: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' }] } },
      ],
    });
    const r = await redactGeminiSecrets(path, null);
    expect(r.replaced).toBeGreaterThanOrEqual(3);

    const rewritten = JSON.parse(readFileSync(path, 'utf-8'));
    const allText = JSON.stringify(rewritten);
    expect(allText).not.toContain('sk-ant-abcdefghijklmnopqrstuv1234');
    expect(allText).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(allText).not.toMatch(/ghp_[a-zA-Z0-9]{30,}/);
    expect(allText).toContain('****REDACTED****');
  });

  it('line filter targets one message', async () => {
    write(path, {
      sessionId: 'gem-5',
      messages: [
        { id: 'm1', timestamp: 't', type: 'user', content: 'first sk-ant-aaaaaaaaaaaaaaaaaaaa1111' },
        { id: 'm2', timestamp: 't', type: 'user', content: 'second sk-ant-bbbbbbbbbbbbbbbbbbbb2222' },
      ],
    });
    const r = await redactGeminiSecrets(path, { lineNumber: 2 });
    expect(r.replaced).toBe(1);
    const rewritten = JSON.parse(readFileSync(path, 'utf-8'));
    expect(rewritten.messages[0].content).toContain('sk-ant-aaaaaaaaaaaaaaaaaaaa1111');
    expect(rewritten.messages[1].content).toContain('****REDACTED****');
  });
});
