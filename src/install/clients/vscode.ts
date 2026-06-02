import { PATHS } from '../paths.js';
import { fileExists } from '../fs-util.js';
import { installMcpFile, uninstallMcpFile, statusMcpFile } from '../mcp-file.js';
import { commandExists, execFileP, fileSpec } from './shared.js';
import type { ClientAdapter } from '../types.js';

// VS Code requires explicit `type` and uses `servers` (not `mcpServers`).
const ENTRY = { type: 'stdio', command: 'conclear', args: ['mcp'] };

export const vscode: ClientAdapter = {
  id: 'vscode',
  displayName: 'VS Code',
  method: 'cli',
  supportsSkill: false,
  async detect() {
    return (await commandExists('code')) || fileExists(PATHS.vscodeMcp);
  },
  async installMcp() {
    if (await commandExists('code')) {
      try {
        await execFileP('code', ['--add-mcp', JSON.stringify({ name: 'conclear', ...ENTRY })]);
        return { ok: true, action: 'installed via `code --add-mcp`' };
      } catch { /* fall through */ }
    }
    return installMcpFile(fileSpec(PATHS.vscodeMcp, 'servers', ENTRY));
  },
  async uninstallMcp() {
    return uninstallMcpFile(fileSpec(PATHS.vscodeMcp, 'servers', ENTRY));
  },
  async status() {
    const file = statusMcpFile(fileSpec(PATHS.vscodeMcp, 'servers', ENTRY));
    return { detected: await this.detect(), mcpInstalled: file.installed, notes: [] };
  },
};
