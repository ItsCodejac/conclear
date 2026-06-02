/**
 * Round-trip tests for the generic JSON-merge MCP installer used by
 * Claude Desktop, Cursor, Windsurf, Antigravity, Cline, Kiro, and as the
 * fallback path for Claude Code and VS Code.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installMcpFile, uninstallMcpFile, statusMcpFile } from '../../src/install/mcp-file.js';

const ENTRY = { command: 'conclear', args: ['mcp'] };

describe('mcp-file install', () => {
  let dir: string;
  let cfg: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'conclear-test-'));
    cfg = join(dir, 'config.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a new config file when none exists', () => {
    const result = installMcpFile({ path: cfg, serversKey: 'mcpServers', entry: ENTRY });
    expect(result.ok).toBe(true);
    expect(existsSync(cfg)).toBe(true);
    const parsed = JSON.parse(readFileSync(cfg, 'utf-8'));
    expect(parsed.mcpServers.conclear).toEqual(ENTRY);
  });

  it('preserves other top-level keys when merging into existing config', () => {
    writeFileSync(cfg, JSON.stringify({
      mcpServers: { existing: { command: 'other', args: [] } },
      preferences: { theme: 'dark' },
    }, null, 2));
    installMcpFile({ path: cfg, serversKey: 'mcpServers', entry: ENTRY });

    const parsed = JSON.parse(readFileSync(cfg, 'utf-8'));
    expect(parsed.mcpServers.conclear).toEqual(ENTRY);
    expect(parsed.mcpServers.existing).toEqual({ command: 'other', args: [] });
    expect(parsed.preferences).toEqual({ theme: 'dark' });
  });

  it('is idempotent — re-running install reports already-installed', () => {
    installMcpFile({ path: cfg, serversKey: 'mcpServers', entry: ENTRY });
    const second = installMcpFile({ path: cfg, serversKey: 'mcpServers', entry: ENTRY });
    expect(second.action).toMatch(/already installed/);
  });

  it('uses a custom serversKey (e.g. VS Code "servers")', () => {
    const vscodeEntry = { type: 'stdio', command: 'conclear', args: ['mcp'] };
    installMcpFile({ path: cfg, serversKey: 'servers', entry: vscodeEntry });
    const parsed = JSON.parse(readFileSync(cfg, 'utf-8'));
    expect(parsed.servers.conclear).toEqual(vscodeEntry);
    expect(parsed.mcpServers).toBeUndefined();
  });

  it('uninstall removes the entry but leaves other servers intact', () => {
    writeFileSync(cfg, JSON.stringify({
      mcpServers: {
        existing: { command: 'other', args: [] },
        conclear: ENTRY,
      },
    }, null, 2));
    const result = uninstallMcpFile({ path: cfg, serversKey: 'mcpServers', entry: ENTRY });
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(readFileSync(cfg, 'utf-8'));
    expect(parsed.mcpServers.conclear).toBeUndefined();
    expect(parsed.mcpServers.existing).toEqual({ command: 'other', args: [] });
  });

  it('uninstall is a no-op when entry is missing', () => {
    writeFileSync(cfg, JSON.stringify({ mcpServers: {} }, null, 2));
    const result = uninstallMcpFile({ path: cfg, serversKey: 'mcpServers', entry: ENTRY });
    expect(result.ok).toBe(true);
    expect(result.action).toMatch(/not installed/);
  });

  it('status correctly reports installed/uninstalled state', () => {
    expect(statusMcpFile({ path: cfg, serversKey: 'mcpServers', entry: ENTRY }).installed).toBe(false);
    installMcpFile({ path: cfg, serversKey: 'mcpServers', entry: ENTRY });
    expect(statusMcpFile({ path: cfg, serversKey: 'mcpServers', entry: ENTRY }).installed).toBe(true);
    uninstallMcpFile({ path: cfg, serversKey: 'mcpServers', entry: ENTRY });
    expect(statusMcpFile({ path: cfg, serversKey: 'mcpServers', entry: ENTRY }).installed).toBe(false);
  });
});
