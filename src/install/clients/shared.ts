/**
 * Helpers shared across client adapters: command detection and the canonical
 * stdio entry shape. Client-specific schema variants stay in their own files.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PLATFORM } from '../paths.js';
import type { McpFileSpec } from '../mcp-file.js';

export const execFileP = promisify(execFile);

/** Most clients: {"command": "conclear", "args": ["mcp"]} under `mcpServers`. */
export const STDIO_ENTRY = { command: 'conclear', args: ['mcp'] };

export async function commandExists(cmd: string): Promise<boolean> {
  try {
    const which = PLATFORM === 'win32' ? 'where' : 'which';
    await execFileP(which, [cmd]);
    return true;
  } catch {
    return false;
  }
}

export function fileSpec(
  path: string,
  serversKey: string,
  entry: Record<string, unknown>,
  followUp?: string,
): McpFileSpec {
  return { path, serversKey, entry, followUp };
}
