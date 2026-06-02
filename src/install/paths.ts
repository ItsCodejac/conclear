/**
 * Per-platform paths to client config files and skill directories.
 *
 * Sources verified against vendor docs (Dec 2025 – Jun 2026) and ground-truth
 * filesystem probes. When a client uses a symlink (e.g. Antigravity's
 * ~/.gemini/antigravity/mcp_config.json → ~/.gemini/config/mcp_config.json),
 * we target the canonical destination, not the symlink.
 */

import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const PLATFORM = platform();

function appSupport(name: string): string {
  if (PLATFORM === 'darwin') return join(HOME, 'Library', 'Application Support', name);
  if (PLATFORM === 'win32') return join(process.env.APPDATA || join(HOME, 'AppData', 'Roaming'), name);
  return join(process.env.XDG_CONFIG_HOME || join(HOME, '.config'), name);
}

export const PATHS = {
  // MCP configs
  claudeCode: join(HOME, '.claude.json'),
  claudeDesktop: join(appSupport('Claude'), 'claude_desktop_config.json'),
  cursorMcp: join(HOME, '.cursor', 'mcp.json'),
  windsurfMcp: join(HOME, '.codeium', 'windsurf', 'mcp_config.json'),
  vscodeMcp: join(appSupport('Code'), 'User', 'mcp.json'),
  antigravityMcp: join(HOME, '.gemini', 'config', 'mcp_config.json'),
  zedSettings: join(HOME, '.config', 'zed', 'settings.json'),
  clineMcp: join(
    appSupport('Code'),
    'User',
    'globalStorage',
    'saoudrizwan.claude-dev',
    'settings',
    'cline_mcp_settings.json',
  ),
  continueConfig: join(HOME, '.continue', 'config.yaml'),
  codexConfig: join(HOME, '.codex', 'config.toml'),
  kiroMcp: join(HOME, '.aws', 'amazonq', 'mcp.json'), // Q Developer legacy path; Kiro CLI may override

  // Skill dirs
  claudeCodeSkills: join(HOME, '.claude', 'skills'),
  cursorSkills: join(HOME, '.cursor', 'skills'),
  antigravitySkills: join(HOME, '.gemini', 'config', 'skills'),

  // Backups
  backupDir: join(HOME, '.conclear', 'backups'),
} as const;

export { HOME, PLATFORM };
