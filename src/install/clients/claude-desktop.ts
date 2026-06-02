import { dirname } from 'node:path';
import { PATHS } from '../paths.js';
import { dirExists } from '../fs-util.js';
import { installMcpFile, uninstallMcpFile, statusMcpFile } from '../mcp-file.js';
import { STDIO_ENTRY, fileSpec } from './shared.js';
import type { ClientAdapter } from '../types.js';

export const claudeDesktop: ClientAdapter = {
  id: 'claude-desktop',
  displayName: 'Claude Desktop',
  method: 'file',
  supportsSkill: false,
  platforms: ['darwin', 'win32'],
  async detect() {
    return dirExists(dirname(PATHS.claudeDesktop));
  },
  async installMcp() {
    return installMcpFile(fileSpec(PATHS.claudeDesktop, 'mcpServers', STDIO_ENTRY, 'restart Claude Desktop to load'));
  },
  async uninstallMcp() {
    return uninstallMcpFile(fileSpec(PATHS.claudeDesktop, 'mcpServers', STDIO_ENTRY, 'restart Claude Desktop'));
  },
  async status() {
    const file = statusMcpFile(fileSpec(PATHS.claudeDesktop, 'mcpServers', STDIO_ENTRY));
    return { detected: await this.detect(), mcpInstalled: file.installed, notes: [] };
  },
};
