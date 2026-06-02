/**
 * Orchestrator for `conclear install`, `conclear uninstall`, `conclear doctor`.
 *
 * Filters adapters by detection + platform + user flags, then runs install /
 * uninstall / status across the selected set and prints a compact report.
 */

import { ADAPTERS, getAdapter } from './adapters.js';
import { PLATFORM } from './paths.js';
import type { ClientAdapter, ClientStatus, InstallResult } from './types.js';

export interface RunOptions {
  /** Specific client IDs to target. Empty = all detected. */
  only?: string[];
  /** Skip skill install/uninstall (MCP only). */
  noSkill?: boolean;
  /** Include undetected clients (force install). */
  all?: boolean;
}

function eligible(adapter: ClientAdapter): boolean {
  if (adapter.platforms && !adapter.platforms.includes(PLATFORM)) return false;
  return true;
}

async function selectAdapters(opts: RunOptions): Promise<ClientAdapter[]> {
  if (opts.only && opts.only.length > 0) {
    const found: ClientAdapter[] = [];
    for (const id of opts.only) {
      const a = getAdapter(id);
      if (!a) throw new Error(`Unknown client: ${id}. Known: ${ADAPTERS.map(x => x.id).join(', ')}`);
      found.push(a);
    }
    return found.filter(eligible);
  }
  const adapters = ADAPTERS.filter(eligible);
  if (opts.all) return adapters;
  const detected: ClientAdapter[] = [];
  for (const a of adapters) {
    if (await a.detect()) detected.push(a);
  }
  return detected;
}

function printResult(adapter: ClientAdapter, label: string, result: InstallResult): void {
  const status = result.ok ? 'ok' : 'fail';
  process.stdout.write(`  [${status}] ${adapter.displayName} ${label}: ${result.action}\n`);
  if (result.followUp) process.stdout.write(`        → ${result.followUp}\n`);
  if (result.manualInstructions) {
    process.stdout.write(result.manualInstructions.split('\n').map(l => `        ${l}`).join('\n') + '\n');
  }
}

export async function runInstall(opts: RunOptions): Promise<void> {
  const adapters = await selectAdapters(opts);
  if (adapters.length === 0) {
    process.stdout.write('No supported clients detected. Use --all to install for every client anyway.\n');
    return;
  }
  process.stdout.write(`Installing ConClear MCP for ${adapters.length} client(s):\n`);
  for (const a of adapters) {
    try {
      printResult(a, 'MCP', await a.installMcp());
      if (!opts.noSkill && a.supportsSkill && a.installSkill) {
        printResult(a, 'skill', await a.installSkill());
      }
    } catch (err: any) {
      process.stdout.write(`  [fail] ${a.displayName}: ${err?.message || err}\n`);
    }
  }
}

export async function runUninstall(opts: RunOptions): Promise<void> {
  const adapters = await selectAdapters({ ...opts, all: true });
  process.stdout.write(`Uninstalling ConClear MCP from ${adapters.length} client(s):\n`);
  for (const a of adapters) {
    try {
      printResult(a, 'MCP', await a.uninstallMcp());
      if (!opts.noSkill && a.supportsSkill && a.uninstallSkill) {
        printResult(a, 'skill', await a.uninstallSkill());
      }
    } catch (err: any) {
      process.stdout.write(`  [fail] ${a.displayName}: ${err?.message || err}\n`);
    }
  }
}

export async function runDoctor(): Promise<void> {
  const adapters = ADAPTERS.filter(eligible);
  process.stdout.write('ConClear install status:\n\n');
  for (const a of adapters) {
    let st: ClientStatus;
    try {
      st = await a.status();
    } catch (err: any) {
      process.stdout.write(`  ${a.displayName.padEnd(22)} ERROR: ${err?.message || err}\n`);
      continue;
    }
    const det = st.detected ? 'detected' : '—       ';
    const mcp = st.mcpInstalled ? 'mcp:on ' : 'mcp:off';
    const skill = a.supportsSkill ? (st.skillInstalled ? 'skill:on' : 'skill:off') : '        ';
    process.stdout.write(`  ${a.displayName.padEnd(22)} ${det}  ${mcp}  ${skill}\n`);
    for (const n of st.notes) process.stdout.write(`    ! ${n}\n`);
  }
}
