import { dirname } from 'node:path';
import { PATHS } from '../paths.js';
import { fileExists, dirExists } from '../fs-util.js';
import { installMcpFile, uninstallMcpFile, statusMcpFile } from '../mcp-file.js';
import { STDIO_ENTRY, fileSpec } from './shared.js';
import type { ClientAdapter } from '../types.js';

export const cline: ClientAdapter = {
  id: 'cline',
  displayName: 'Cline',
  method: 'file',
  supportsSkill: false,
  async detect() {
    return fileExists(PATHS.clineMcp) || dirExists(dirname(PATHS.clineMcp));
  },
  async installMcp() {
    return installMcpFile(fileSpec(PATHS.clineMcp, 'mcpServers', STDIO_ENTRY));
  },
  async uninstallMcp() {
    return uninstallMcpFile(fileSpec(PATHS.clineMcp, 'mcpServers', STDIO_ENTRY));
  },
  async status() {
    const file = statusMcpFile(fileSpec(PATHS.clineMcp, 'mcpServers', STDIO_ENTRY));
    return { detected: await this.detect(), mcpInstalled: file.installed, notes: [] };
  },
};
