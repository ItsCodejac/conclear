import { dirname } from 'node:path';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { PATHS } from '../paths.js';
import { fileExists, backupFile } from '../fs-util.js';
import { commandExists, execFileP } from './shared.js';
import type { ClientAdapter } from '../types.js';

// Marker-delimited block so we can roundtrip into a TOML file without parsing it.
const BLOCK = [
  '',
  '# conclear-mcp (managed by `conclear install`)',
  '[mcp_servers.conclear]',
  'command = "conclear"',
  'args = ["mcp"]',
  '# /conclear-mcp',
].join('\n') + '\n';

const BLOCK_RE = /\n?# conclear-mcp \(managed by `conclear install`\)[\s\S]*?# \/conclear-mcp\n?/g;

export const codex: ClientAdapter = {
  id: 'codex',
  displayName: 'Codex CLI',
  method: 'cli',
  supportsSkill: false,
  async detect() {
    return (await commandExists('codex')) || fileExists(PATHS.codexConfig);
  },
  async installMcp() {
    if (await commandExists('codex')) {
      try {
        await execFileP('codex', ['mcp', 'add', 'conclear', '--', 'conclear', 'mcp']);
        return { ok: true, action: 'installed via `codex mcp add`' };
      } catch { /* fall through to TOML append */ }
    }
    if (fileExists(PATHS.codexConfig)) {
      const current = readFileSync(PATHS.codexConfig, 'utf-8');
      if (current.includes('[mcp_servers.conclear]')) {
        return { ok: true, action: `already installed in ${PATHS.codexConfig}` };
      }
      backupFile(PATHS.codexConfig);
      appendFileSync(PATHS.codexConfig, BLOCK);
    } else {
      mkdirSync(dirname(PATHS.codexConfig), { recursive: true });
      writeFileSync(PATHS.codexConfig, BLOCK.trimStart());
    }
    return { ok: true, action: `appended to ${PATHS.codexConfig}` };
  },
  async uninstallMcp() {
    if (await commandExists('codex')) {
      try {
        await execFileP('codex', ['mcp', 'remove', 'conclear']);
        return { ok: true, action: 'removed via `codex mcp remove`' };
      } catch { /* fall through */ }
    }
    if (!fileExists(PATHS.codexConfig)) return { ok: true, action: 'not installed' };
    const current = readFileSync(PATHS.codexConfig, 'utf-8');
    const stripped = current.replace(BLOCK_RE, '');
    if (stripped === current) return { ok: true, action: 'not installed (no managed block found)' };
    backupFile(PATHS.codexConfig);
    writeFileSync(PATHS.codexConfig, stripped);
    return { ok: true, action: `removed from ${PATHS.codexConfig}` };
  },
  async status() {
    let installed = false;
    if (fileExists(PATHS.codexConfig)) {
      installed = readFileSync(PATHS.codexConfig, 'utf-8').includes('[mcp_servers.conclear]');
    }
    return { detected: await this.detect(), mcpInstalled: installed, notes: [] };
  },
};
