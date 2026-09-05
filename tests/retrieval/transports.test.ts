import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const exec = promisify(execFile);
let dir: string;
let env: Record<string, string>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'conclear-transport-'));
  const project = join(dir, '.claude', 'projects', '-fixture');
  mkdirSync(project, { recursive: true });
  const messages = ['pair_dip appears profitable', 'test pending', 'guard removes the profit', 'do not revive the strategy'];
  const records = messages.map((text, i) => ({ type: 'assistant', uuid: `m${i}`, sessionId: 'fixture', timestamp: new Date(1700000000000 + i * 1000).toISOString(), message: { role: 'assistant', content: [{ type: 'text', text }] } }));
  writeFileSync(join(project, 'fixture.jsonl'), records.map(r => JSON.stringify(r)).join('\n'));
  env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  env.CONCLEAR_DEMO_ROOT = dir;
  env.CONCLEAR_NO_UPDATE_CHECK = '1';
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
const cliArgs = ['--import', 'tsx', resolve('src/cli.ts')];

describe('retrieval transports', () => {
  it('CLI search references resolve into bounded context and valid continuations', async () => {
    const search = JSON.parse((await exec(process.execPath, [...cliArgs, 'search', 'pair_dip', '--json'], { env })).stdout);
    const hit = search.matches[0];
    expect(hit.sessionId).toBe('fixture');
    const context = JSON.parse((await exec(process.execPath, [...cliArgs, 'context', hit.sessionId, '--tool', hit.tool, '--around', hit.messageRef, '--before', '0', '--after', '1', '--json'], { env })).stdout);
    expect(context.messages).toHaveLength(2);
    const next = JSON.parse((await exec(process.execPath, [...cliArgs, 'context', hit.sessionId, '--cursor', context.page.nextCursor, '--json'], { env })).stdout);
    expect(next.messages[0].text).toBe('guard removes the profit');
    expect(next.page.hasLater).toBe(false);
    await expect(exec(process.execPath, [...cliArgs, 'context', 'fixture', '--max-chars', 'bad'], { env })).rejects.toMatchObject({ code: 1 });
  });
  it('MCP exposes the new schema, returns JSON pages, and signals invalid references', async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [...cliArgs, 'mcp'], env, stderr: 'pipe' });
    const client = new Client({ name: 'retrieval-test', version: '1.0.0' });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.find(t => t.name === 'conclear_context')?.inputSchema.properties).toHaveProperty('cursor');
      const search = await client.callTool({ name: 'conclear_search', arguments: { query: 'pair_dip' } });
      const hit = JSON.parse((search.content as Array<{ text: string }>)[0].text).matches[0];
      const result = await client.callTool({ name: 'conclear_context', arguments: { session: hit.sessionId, tool: hit.tool, around: hit.messageRef, before: 0, after: 3 } });
      const page = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(page.messages.map((m: { text: string }) => m.text)).toContain('guard removes the profit');
      expect(page.page.complete).toBe(true);
      const invalid = await client.callTool({ name: 'conclear_context', arguments: { session: hit.sessionId, around: 'missing-reference' } });
      expect(invalid.isError).toBe(true);
    } finally { await client.close(); }
  });
});
