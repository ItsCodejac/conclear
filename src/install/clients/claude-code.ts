import { PATHS } from '../paths.js';
import { fileExists } from '../fs-util.js';
import { installMcpFile, uninstallMcpFile, statusMcpFile } from '../mcp-file.js';
import { installSkillTo, uninstallSkillFrom, skillInstalledAt } from '../skill.js';
import { commandExists, execFileP, fileSpec } from './shared.js';
import type { ClientAdapter } from '../types.js';

const ENTRY = { type: 'stdio', command: 'conclear', args: ['mcp'] };

export const claudeCode: ClientAdapter = {
  id: 'claude-code',
  displayName: 'Claude Code',
  method: 'cli',
  supportsSkill: true,
  async detect() {
    return (await commandExists('claude')) || fileExists(PATHS.claudeCode);
  },
  async installMcp() {
    if (await commandExists('claude')) {
      try {
        await execFileP('claude', ['mcp', 'add', 'conclear', '--scope', 'user', '--', 'conclear', 'mcp']);
        return { ok: true, action: 'installed via `claude mcp add`' };
      } catch (err: any) {
        if (String(err?.stderr || '').includes('already exists')) {
          return { ok: true, action: 'already installed (via claude mcp)' };
        }
      }
    }
    return installMcpFile(fileSpec(PATHS.claudeCode, 'mcpServers', ENTRY));
  },
  async uninstallMcp() {
    if (await commandExists('claude')) {
      try {
        await execFileP('claude', ['mcp', 'remove', 'conclear', '--scope', 'user']);
        return { ok: true, action: 'removed via `claude mcp remove`' };
      } catch { /* fall through */ }
    }
    return uninstallMcpFile(fileSpec(PATHS.claudeCode, 'mcpServers', ENTRY));
  },
  async installSkill() { return installSkillTo(PATHS.claudeCodeSkills); },
  async uninstallSkill() { return uninstallSkillFrom(PATHS.claudeCodeSkills); },
  async status() {
    const file = statusMcpFile(fileSpec(PATHS.claudeCode, 'mcpServers', ENTRY));
    return {
      detected: await this.detect(),
      mcpInstalled: file.installed,
      skillInstalled: skillInstalledAt(PATHS.claudeCodeSkills),
      notes: [],
    };
  },
};
