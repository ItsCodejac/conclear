import { dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { PATHS } from '../paths.js';
import { fileExists, dirExists } from '../fs-util.js';
import type { ClientAdapter } from '../types.js';

// Continue uses a YAML config; safe automated merge needs a YAML parser
// we'd rather not add as a dep. Until that's worth it, install is manual.
const SNIPPET = [
  `Add to ${PATHS.continueConfig} under \`mcpServers:\`:`,
  ``,
  `  - name: conclear`,
  `    command: conclear`,
  `    args:`,
  `      - mcp`,
].join('\n');

export const continueExt: ClientAdapter = {
  id: 'continue',
  displayName: 'Continue',
  method: 'manual',
  supportsSkill: false,
  async detect() {
    return dirExists(dirname(PATHS.continueConfig));
  },
  async installMcp() {
    return { ok: true, action: 'manual install required (YAML config)', manualInstructions: SNIPPET };
  },
  async uninstallMcp() {
    return { ok: true, action: `manual: remove the \`conclear\` block from ${PATHS.continueConfig}` };
  },
  async status() {
    let installed = false;
    if (fileExists(PATHS.continueConfig)) {
      installed = /name:\s*conclear\b/.test(readFileSync(PATHS.continueConfig, 'utf-8'));
    }
    return { detected: await this.detect(), mcpInstalled: installed, notes: ['YAML config — install is manual'] };
  },
};
