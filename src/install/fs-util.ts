/**
 * Shared filesystem helpers for adapters: atomic JSON read/merge/write with
 * timestamped backups in ~/.conclear/backups/.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { PATHS } from './paths.js';

/** Read a JSON file. Returns an empty object if the file is missing or empty. */
export function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf-8').trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    throw new Error(`Config file is not valid JSON: ${path}`);
  }
}

/** Backup a file before mutation. No-op if the file doesn't exist. */
export function backupFile(path: string): string | null {
  if (!existsSync(path)) return null;
  mkdirSync(PATHS.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = join(PATHS.backupDir, `${basename(path)}.${stamp}.bak`);
  copyFileSync(path, dest);
  return dest;
}

/** Pretty-write JSON, ensuring the parent dir exists. Preserves indentation style of the original file when possible. */
export function writeJson(path: string, data: Record<string, unknown>, indent: number | string = 2): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, indent) + '\n', 'utf-8');
}

/** Detect whether a file uses tab indentation (preserves user style). */
export function detectIndent(path: string): number | string {
  if (!existsSync(path)) return 2;
  const raw = readFileSync(path, 'utf-8');
  const match = raw.match(/^([\t ]+)\S/m);
  if (!match) return 2;
  return match[1].startsWith('\t') ? '\t' : match[1].length;
}

/** Returns true if a file exists and is a regular file. */
export function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Returns true if a directory exists. */
export function dirExists(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
