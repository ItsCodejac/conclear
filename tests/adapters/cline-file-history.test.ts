/**
 * Cline file history shipped without behavioural tests because the dev machine
 * had no Cline data. These tests fixture the api_conversation_history.json
 * shape directly and verify parseFileHistory + getFileContent.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFileHistory, getFileContent } from '../../src/server/adapters/cline/parser.js';

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}
interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | Array<{ type: 'text'; text: string }>;
}
interface ApiMessage {
  role: 'user' | 'assistant';
  content: Array<ToolUseBlock | ToolResultBlock | { type: 'text'; text: string }>;
}

function writeApi(taskDir: string, messages: ApiMessage[]): string {
  mkdirSync(taskDir, { recursive: true });
  const apiPath = join(taskDir, 'api_conversation_history.json');
  writeFileSync(apiPath, JSON.stringify(messages, null, 2));
  return apiPath;
}

describe('Cline parseFileHistory + getFileContent', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'conclear-cline-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('captures write_to_file content from input.content', async () => {
    const apiPath = writeApi(dir, [
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool-1',
          name: 'write_to_file',
          input: { path: 'src/foo.ts', content: 'export const x = 1;\n' },
        }],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file written' }] },
    ]);

    const histories = await parseFileHistory(apiPath);
    expect(histories).toHaveLength(1);
    expect(histories[0].filePath).toBe('src/foo.ts');
    expect(histories[0].versions).toHaveLength(1);
    expect(histories[0].versions[0].operation).toBe('write');

    const content = await getFileContent(apiPath, histories[0].versions[0].lineNumber);
    expect(content).toBe('export const x = 1;\n');
  });

  it('captures read_file content from the user-side tool_result', async () => {
    const apiPath = writeApi(dir, [
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool-2',
          name: 'read_file',
          input: { path: 'src/bar.ts' },
        }],
      },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-2',
          content: 'export const y = 2;\n',
        }],
      },
    ]);

    const histories = await parseFileHistory(apiPath);
    expect(histories).toHaveLength(1);
    expect(histories[0].filePath).toBe('src/bar.ts');
    expect(histories[0].versions[0].operation).toBe('read');

    const content = await getFileContent(apiPath, histories[0].versions[0].lineNumber);
    expect(content).toBe('export const y = 2;\n');
  });

  it('captures replace_in_file diffs from input.diff', async () => {
    const apiPath = writeApi(dir, [
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool-3',
          name: 'replace_in_file',
          input: { path: 'src/baz.ts', diff: '<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE' },
        }],
      },
    ]);

    const histories = await parseFileHistory(apiPath);
    expect(histories).toHaveLength(1);
    expect(histories[0].versions[0].operation).toBe('edit');

    const content = await getFileContent(apiPath, histories[0].versions[0].lineNumber);
    expect(content).toContain('SEARCH');
    expect(content).toContain('REPLACE');
  });

  it('groups multiple operations on the same file into one history with N versions', async () => {
    const apiPath = writeApi(dir, [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'x.ts' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'original' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'write_to_file', input: { path: 'x.ts', content: 'updated' } }] },
    ]);

    const histories = await parseFileHistory(apiPath);
    expect(histories).toHaveLength(1);
    expect(histories[0].filePath).toBe('x.ts');
    expect(histories[0].versions).toHaveLength(2);
    expect(histories[0].versions.map(v => v.operation)).toEqual(['read', 'write']);
  });

  it('returns empty array for malformed JSON gracefully', async () => {
    const apiPath = join(dir, 'api_conversation_history.json');
    writeFileSync(apiPath, 'not valid json');
    const histories = await parseFileHistory(apiPath);
    expect(histories).toEqual([]);
  });

  it('returns null for getFileContent on out-of-range index', async () => {
    const apiPath = writeApi(dir, [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
    expect(await getFileContent(apiPath, 99)).toBeNull();
  });
});
