/**
 * Skill install: copy skill.md → <client-skills-dir>/conclear/SKILL.md.
 *
 * Supported clients (as of Jun 2026): Claude Code, Cursor (v2.2+),
 * Google Antigravity. Others have no skills system or use rules files.
 */

import { copyFileSync, mkdirSync, existsSync, unlinkSync, rmdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileExists } from './fs-util.js';
import type { InstallResult } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Locate the bundled skill.md — works in dev (src/install/) and prod (dist/install/). */
function resolveSkillSource(): string {
  const candidates = [
    join(__dirname, '..', '..', 'skill.md'),       // dist/install/ → repo root
    join(__dirname, '..', '..', '..', 'skill.md'), // src/install/ → repo root (during dev)
    join(__dirname, 'skill.md'),
  ];
  for (const c of candidates) {
    if (fileExists(c)) return c;
  }
  throw new Error('skill.md not found — reinstall conclear');
}

export function installSkillTo(skillsDir: string): InstallResult {
  const source = resolveSkillSource();
  const dest = join(skillsDir, 'conclear', 'SKILL.md');
  mkdirSync(dirname(dest), { recursive: true });

  if (fileExists(dest)) {
    const current = readFileSync(dest, 'utf-8');
    const incoming = readFileSync(source, 'utf-8');
    if (current === incoming) return { ok: true, action: `skill already installed at ${dest}` };
  }

  copyFileSync(source, dest);
  return { ok: true, action: `installed skill → ${dest}` };
}

export function uninstallSkillFrom(skillsDir: string): InstallResult {
  const dest = join(skillsDir, 'conclear', 'SKILL.md');
  if (!existsSync(dest)) return { ok: true, action: `skill not installed at ${dest}` };
  unlinkSync(dest);
  try { rmdirSync(dirname(dest)); } catch { /* dir not empty, leave it */ }
  return { ok: true, action: `removed skill at ${dest}` };
}

export function skillInstalledAt(skillsDir: string): boolean {
  return fileExists(join(skillsDir, 'conclear', 'SKILL.md'));
}
