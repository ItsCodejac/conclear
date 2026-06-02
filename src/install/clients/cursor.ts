import { dirname } from 'node:path';
import { PATHS } from '../paths.js';
import { fileExists, dirExists } from '../fs-util.js';
import { installMcpFile, uninstallMcpFile, statusMcpFile } from '../mcp-file.js';
import { installSkillTo, uninstallSkillFrom, skillInstalledAt } from '../skill.js';
import { STDIO_ENTRY, fileSpec } from './shared.js';
import type { ClientAdapter } from '../types.js';

export const cursor: ClientAdapter = {
  id: 'cursor',
  displayName: 'Cursor',
  method: 'file',
  supportsSkill: true,
  async detect() {
    return dirExists(dirname(PATHS.cursorMcp)) || fileExists(PATHS.cursorMcp);
  },
  async installMcp() {
    return installMcpFile(fileSpec(PATHS.cursorMcp, 'mcpServers', STDIO_ENTRY));
  },
  async uninstallMcp() {
    return uninstallMcpFile(fileSpec(PATHS.cursorMcp, 'mcpServers', STDIO_ENTRY));
  },
  async installSkill() { return installSkillTo(PATHS.cursorSkills); },
  async uninstallSkill() { return uninstallSkillFrom(PATHS.cursorSkills); },
  async status() {
    const file = statusMcpFile(fileSpec(PATHS.cursorMcp, 'mcpServers', STDIO_ENTRY));
    return {
      detected: await this.detect(),
      mcpInstalled: file.installed,
      skillInstalled: skillInstalledAt(PATHS.cursorSkills),
      notes: [],
    };
  },
};
