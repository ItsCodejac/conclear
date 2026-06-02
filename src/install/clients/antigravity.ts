import { dirname } from 'node:path';
import { PATHS } from '../paths.js';
import { dirExists } from '../fs-util.js';
import { installMcpFile, uninstallMcpFile, statusMcpFile } from '../mcp-file.js';
import { installSkillTo, uninstallSkillFrom, skillInstalledAt } from '../skill.js';
import { STDIO_ENTRY, fileSpec } from './shared.js';
import type { ClientAdapter } from '../types.js';

export const antigravity: ClientAdapter = {
  id: 'antigravity',
  displayName: 'Google Antigravity',
  method: 'file',
  supportsSkill: true,
  async detect() {
    return dirExists(dirname(PATHS.antigravityMcp)) || dirExists(dirname(PATHS.antigravitySkills));
  },
  async installMcp() {
    return installMcpFile(fileSpec(PATHS.antigravityMcp, 'mcpServers', STDIO_ENTRY));
  },
  async uninstallMcp() {
    return uninstallMcpFile(fileSpec(PATHS.antigravityMcp, 'mcpServers', STDIO_ENTRY));
  },
  async installSkill() { return installSkillTo(PATHS.antigravitySkills); },
  async uninstallSkill() { return uninstallSkillFrom(PATHS.antigravitySkills); },
  async status() {
    const file = statusMcpFile(fileSpec(PATHS.antigravityMcp, 'mcpServers', STDIO_ENTRY));
    return {
      detected: await this.detect(),
      mcpInstalled: file.installed,
      skillInstalled: skillInstalledAt(PATHS.antigravitySkills),
      notes: [],
    };
  },
};
