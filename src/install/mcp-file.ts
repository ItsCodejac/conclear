/**
 * Generic file-based MCP installer. Reads the client's JSON config, merges in
 * (or removes) the ConClear server entry, writes back atomically with backup.
 *
 * Per-client schema differences (VS Code's `servers` key, Zed's nested
 * `context_servers` + required `source: custom`, etc.) are passed in as a
 * spec rather than branched on.
 */

import { backupFile, readJson, writeJson, detectIndent, fileExists } from './fs-util.js';
import type { InstallResult } from './types.js';

export interface McpFileSpec {
  /** Where the config lives. */
  path: string;
  /** Top-level key holding servers: `mcpServers` for most, `servers` for VS Code, `context_servers` for Zed. */
  serversKey: string;
  /** ConClear entry as the client expects it. */
  entry: Record<string, unknown>;
  /** Required follow-up shown to the user (e.g. "restart Claude Desktop"). */
  followUp?: string;
}

const ENTRY_NAME = 'conclear';

export function installMcpFile(spec: McpFileSpec): InstallResult {
  const config = readJson(spec.path);
  const indent = detectIndent(spec.path);
  const servers = (config[spec.serversKey] as Record<string, unknown>) || {};

  const existing = servers[ENTRY_NAME];
  if (JSON.stringify(existing) === JSON.stringify(spec.entry)) {
    return { ok: true, action: `already installed in ${spec.path}` };
  }

  const backup = backupFile(spec.path);
  servers[ENTRY_NAME] = spec.entry;
  config[spec.serversKey] = servers;
  writeJson(spec.path, config, indent);

  return {
    ok: true,
    action: backup ? `updated ${spec.path}` : `created ${spec.path}`,
    followUp: spec.followUp,
  };
}

export function uninstallMcpFile(spec: McpFileSpec): InstallResult {
  if (!fileExists(spec.path)) {
    return { ok: true, action: `not installed (no config at ${spec.path})` };
  }
  const config = readJson(spec.path);
  const servers = (config[spec.serversKey] as Record<string, unknown>) || {};
  if (!(ENTRY_NAME in servers)) {
    return { ok: true, action: `not installed in ${spec.path}` };
  }
  backupFile(spec.path);
  delete servers[ENTRY_NAME];
  config[spec.serversKey] = servers;
  writeJson(spec.path, config, detectIndent(spec.path));
  return { ok: true, action: `removed from ${spec.path}`, followUp: spec.followUp };
}

export function statusMcpFile(spec: McpFileSpec): { installed: boolean; path: string } {
  if (!fileExists(spec.path)) return { installed: false, path: spec.path };
  const config = readJson(spec.path);
  const servers = (config[spec.serversKey] as Record<string, unknown>) || {};
  return { installed: ENTRY_NAME in servers, path: spec.path };
}
