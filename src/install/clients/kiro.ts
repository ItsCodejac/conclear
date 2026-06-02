import { PATHS } from '../paths.js';
import { fileExists } from '../fs-util.js';
import { installMcpFile, uninstallMcpFile, statusMcpFile } from '../mcp-file.js';
import { STDIO_ENTRY, commandExists, fileSpec } from './shared.js';
import type { ClientAdapter } from '../types.js';

export const kiro: ClientAdapter = {
  id: 'kiro',
  displayName: 'Kiro CLI',
  method: 'file',
  supportsSkill: false,
  async detect() {
    return (await commandExists('kiro')) || fileExists(PATHS.kiroMcp);
  },
  async installMcp() {
    return installMcpFile(fileSpec(PATHS.kiroMcp, 'mcpServers', STDIO_ENTRY));
  },
  async uninstallMcp() {
    return uninstallMcpFile(fileSpec(PATHS.kiroMcp, 'mcpServers', STDIO_ENTRY));
  },
  async status() {
    const file = statusMcpFile(fileSpec(PATHS.kiroMcp, 'mcpServers', STDIO_ENTRY));
    // Kiro inherits the Amazon Q Developer config path. Surface this so the
    // user can confirm before relying on it.
    return {
      detected: await this.detect(),
      mcpInstalled: file.installed,
      notes: ['Kiro config path inherited from Amazon Q Developer — verify after install'],
    };
  },
};
