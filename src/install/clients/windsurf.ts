import { dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { PATHS } from '../paths.js';
import { dirExists } from '../fs-util.js';
import { installMcpFile, uninstallMcpFile, statusMcpFile } from '../mcp-file.js';
import { STDIO_ENTRY, fileSpec } from './shared.js';
import type { ClientAdapter } from '../types.js';

export const windsurf: ClientAdapter = {
  id: 'windsurf',
  displayName: 'Windsurf',
  method: 'file',
  supportsSkill: false,
  async detect() {
    return dirExists(dirname(PATHS.windsurfMcp));
  },
  async installMcp() {
    return installMcpFile(fileSpec(PATHS.windsurfMcp, 'mcpServers', STDIO_ENTRY));
  },
  async uninstallMcp() {
    return uninstallMcpFile(fileSpec(PATHS.windsurfMcp, 'mcpServers', STDIO_ENTRY));
  },
  async status() {
    const file = statusMcpFile(fileSpec(PATHS.windsurfMcp, 'mcpServers', STDIO_ENTRY));
    const notes: string[] = [];
    if (file.installed) {
      try {
        const cfg = JSON.parse(readFileSync(PATHS.windsurfMcp, 'utf-8'));
        const serverCount = Object.keys(cfg.mcpServers || {}).length;
        if (serverCount > 8) notes.push(`${serverCount} MCP servers configured — Windsurf has a ~100-tool hard cap`);
      } catch { /* ignore */ }
    }
    return { detected: await this.detect(), mcpInstalled: file.installed, notes };
  },
};
