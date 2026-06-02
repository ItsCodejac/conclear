import { PATHS } from '../paths.js';
import { fileExists } from '../fs-util.js';
import { installMcpJsonc, uninstallMcpJsonc, statusMcpJsonc, type JsoncSpec } from '../jsonc-util.js';
import type { ClientAdapter } from '../types.js';

// Zed nests servers under `context_servers` and requires `source: "custom"`
// or the entry is silently dropped at load time. settings.json is JSONC —
// we use jsonc-parser to preserve comments/formatting across edits.
const ENTRY = { source: 'custom', command: 'conclear', args: ['mcp'] };

const SPEC: JsoncSpec = {
  path: PATHS.zedSettings,
  serversKey: 'context_servers',
  entry: ENTRY,
};

export const zed: ClientAdapter = {
  id: 'zed',
  displayName: 'Zed',
  method: 'file',
  supportsSkill: false,
  async detect() {
    return fileExists(PATHS.zedSettings);
  },
  async installMcp() { return installMcpJsonc(SPEC); },
  async uninstallMcp() { return uninstallMcpJsonc(SPEC); },
  async status() {
    const file = statusMcpJsonc(SPEC);
    return { detected: await this.detect(), mcpInstalled: file.installed, notes: [] };
  },
};
