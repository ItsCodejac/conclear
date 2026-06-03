/**
 * Redact pipeline tests for the Claude adapter.
 *
 * `redactSecretsInFile` is the core of the Security page's "Redact all" and
 * per-finding redact buttons. Since it physically rewrites session files,
 * regressions are expensive — every supported secret pattern, the line
 * filter, and the no-op case need automated coverage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redactSecretsInFile, scanForSecrets } from '../../src/server/adapters/claude/parser.js';

function jsonl(lines: object[]): string {
  return lines.map(l => JSON.stringify(l)).join('\n') + '\n';
}

describe('redactSecretsInFile', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'conclear-redact-'));
    path = join(dir, 'session.jsonl');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('redacts an OpenAI/Anthropic api_key match', async () => {
    writeFileSync(path, jsonl([
      { message: { content: 'my key is sk-ant-abcdefghijklmnopqrstuv1234' } },
    ]));
    const { content, replaced } = await redactSecretsInFile(path, null);
    expect(replaced).toBe(1);
    expect(content).toContain('****REDACTED****');
    expect(content).not.toContain('sk-ant-abcdefghijklmnopqrstuv1234');
  });

  it('redacts GitHub PAT, AWS access key, and Bearer token in one pass', async () => {
    writeFileSync(path, jsonl([
      { message: { content: 'export GHTOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789' } },
      { message: { content: 'aws key AKIAIOSFODNN7EXAMPLE' } },
      { message: { content: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456' } },
    ]));
    const { content, replaced } = await redactSecretsInFile(path, null);
    expect(replaced).toBeGreaterThanOrEqual(3);
    expect(content).not.toMatch(/ghp_[a-zA-Z0-9]{30,}/);
    expect(content).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(content).not.toMatch(/Bearer [a-zA-Z0-9._-]{20,}(?!\*)/);
  });

  it('line filter only redacts matches on the targeted line', async () => {
    writeFileSync(path, jsonl([
      { message: { content: 'first sk-ant-aaaaaaaaaaaaaaaaaaaa1111' } },
      { message: { content: 'second sk-ant-bbbbbbbbbbbbbbbbbbbb2222' } },
      { message: { content: 'third sk-ant-cccccccccccccccccccc3333' } },
    ]));
    const { content, replaced } = await redactSecretsInFile(path, { lineNumber: 2 });
    expect(replaced).toBe(1);
    const lines = content.trim().split('\n');
    expect(lines[0]).toContain('sk-ant-aaaaaaaaaaaaaaaaaaaa1111');
    expect(lines[1]).toContain('****REDACTED****');
    expect(lines[2]).toContain('sk-ant-cccccccccccccccccccc3333');
  });

  it('type filter limits redaction to the named pattern', async () => {
    writeFileSync(path, jsonl([
      { message: { content: 'key sk-ant-abcdefghijklmnopqrstuv1234 plus AKIAIOSFODNN7EXAMPLE' } },
    ]));
    const { content, replaced } = await redactSecretsInFile(path, { type: 'aws_key' });
    expect(replaced).toBe(1);
    expect(content).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(content).toContain('sk-ant-abcdefghijklmnopqrstuv1234');
  });

  it('returns 0 replacements when the file has no secrets', async () => {
    writeFileSync(path, jsonl([
      { message: { content: 'just a plain message with no credentials' } },
    ]));
    const { content, replaced } = await redactSecretsInFile(path, null);
    expect(replaced).toBe(0);
    expect(content).toContain('just a plain message with no credentials');
  });

  it('preserves JSON structure so the line remains parseable after redaction', async () => {
    writeFileSync(path, jsonl([
      { timestamp: '2026-06-03T12:00:00Z', message: { role: 'user', content: 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789' } },
    ]));
    const { content } = await redactSecretsInFile(path, null);
    const line = content.trim().split('\n')[0];
    expect(() => JSON.parse(line)).not.toThrow();
    const parsed = JSON.parse(line);
    expect(parsed.timestamp).toBe('2026-06-03T12:00:00Z');
    expect(parsed.message.role).toBe('user');
    expect(parsed.message.content).toContain('****REDACTED****');
  });

  it('a follow-up scan finds no secrets after a full redact', async () => {
    writeFileSync(path, jsonl([
      { message: { content: 'sk-ant-abcdefghijklmnopqrstuv1234' } },
      { message: { content: 'AKIAIOSFODNN7EXAMPLE' } },
    ]));
    const { content } = await redactSecretsInFile(path, null);
    writeFileSync(path, content);
    const findings = await scanForSecrets(path);
    expect(findings).toHaveLength(0);
  });
});
