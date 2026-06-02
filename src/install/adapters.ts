/**
 * Registry of all client adapters. Per-client logic lives in clients/*.ts.
 */

import type { ClientAdapter } from './types.js';
import { claudeCode } from './clients/claude-code.js';
import { claudeDesktop } from './clients/claude-desktop.js';
import { cursor } from './clients/cursor.js';
import { windsurf } from './clients/windsurf.js';
import { vscode } from './clients/vscode.js';
import { antigravity } from './clients/antigravity.js';
import { zed } from './clients/zed.js';
import { cline } from './clients/cline.js';
import { continueExt } from './clients/continue.js';
import { codex } from './clients/codex.js';
import { kiro } from './clients/kiro.js';

export const ADAPTERS: ClientAdapter[] = [
  claudeCode,
  claudeDesktop,
  cursor,
  windsurf,
  vscode,
  antigravity,
  zed,
  cline,
  continueExt,
  codex,
  kiro,
];

export function getAdapter(id: string): ClientAdapter | undefined {
  return ADAPTERS.find(a => a.id === id);
}
