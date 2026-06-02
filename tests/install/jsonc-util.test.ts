/**
 * Zed (and any future JSONC-config client) needs install/uninstall to preserve
 * the user's comments and formatting. These tests assert that round-trip
 * edits via jsonc-parser do not destroy comments.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installMcpJsonc, uninstallMcpJsonc, statusMcpJsonc } from '../../src/install/jsonc-util.js';

const ZED_ENTRY = { source: 'custom', command: 'conclear', args: ['mcp'] };

describe('jsonc-util install', () => {
  let dir: string;
  let cfg: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'conclear-jsonc-test-'));
    cfg = join(dir, 'settings.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('preserves leading comments through install + uninstall', () => {
    const source = `// Zed settings
//
// For information on how to configure Zed, see
// https://zed.dev/docs/configuring-zed
{
  "theme": "One Dark",
  "buffer_font_size": 14
}
`;
    writeFileSync(cfg, source);

    installMcpJsonc({ path: cfg, serversKey: 'context_servers', entry: ZED_ENTRY });
    const afterInstall = readFileSync(cfg, 'utf-8');
    expect(afterInstall).toContain('// Zed settings');
    expect(afterInstall).toContain('// https://zed.dev/docs/configuring-zed');
    expect(afterInstall).toContain('"theme": "One Dark"');
    expect(afterInstall).toContain('"conclear"');
    expect(afterInstall).toContain('"source": "custom"');

    uninstallMcpJsonc({ path: cfg, serversKey: 'context_servers', entry: ZED_ENTRY });
    const afterUninstall = readFileSync(cfg, 'utf-8');
    expect(afterUninstall).toContain('// Zed settings');
    expect(afterUninstall).toContain('"theme": "One Dark"');
    expect(afterUninstall).not.toContain('"conclear"');
  });

  it('preserves inline trailing comments', () => {
    const source = `{
  "theme": "One Dark", // dark mode is best
  "buffer_font_size": 14 // comfortable size
}
`;
    writeFileSync(cfg, source);
    installMcpJsonc({ path: cfg, serversKey: 'context_servers', entry: ZED_ENTRY });
    const after = readFileSync(cfg, 'utf-8');
    expect(after).toContain('// dark mode is best');
    expect(after).toContain('// comfortable size');
  });

  it('is idempotent — second install reports already installed', () => {
    writeFileSync(cfg, '{}');
    installMcpJsonc({ path: cfg, serversKey: 'context_servers', entry: ZED_ENTRY });
    const second = installMcpJsonc({ path: cfg, serversKey: 'context_servers', entry: ZED_ENTRY });
    expect(second.action).toMatch(/already installed/);
  });

  it('status reports correctly through install / uninstall cycle', () => {
    writeFileSync(cfg, '// comment\n{}');
    expect(statusMcpJsonc({ path: cfg, serversKey: 'context_servers', entry: ZED_ENTRY }).installed).toBe(false);
    installMcpJsonc({ path: cfg, serversKey: 'context_servers', entry: ZED_ENTRY });
    expect(statusMcpJsonc({ path: cfg, serversKey: 'context_servers', entry: ZED_ENTRY }).installed).toBe(true);
    uninstallMcpJsonc({ path: cfg, serversKey: 'context_servers', entry: ZED_ENTRY });
    expect(statusMcpJsonc({ path: cfg, serversKey: 'context_servers', entry: ZED_ENTRY }).installed).toBe(false);
  });
});
