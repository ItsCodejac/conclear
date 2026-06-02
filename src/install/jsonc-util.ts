/**
 * JSONC-aware read/install/uninstall for clients whose configs allow
 * comments and trailing commas (Zed; potentially future VS Code variants).
 *
 * Uses microsoft/jsonc-parser to surgically modify source text — comments,
 * formatting, and trailing commas are preserved across edits.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse, modify, applyEdits, type ParseError } from 'jsonc-parser';
import { backupFile, detectIndent, fileExists } from './fs-util.js';
import type { InstallResult } from './types.js';

export interface JsoncSpec {
  path: string;
  /** Top-level key (e.g. "context_servers"). */
  serversKey: string;
  /** Entry shape as the client expects it. */
  entry: Record<string, unknown>;
  followUp?: string;
}

const ENTRY_NAME = 'conclear';

function readSource(path: string): string {
  if (!existsSync(path)) return '{}';
  const raw = readFileSync(path, 'utf-8');
  return raw.trim() === '' ? '{}' : raw;
}

function indentOf(path: string): number {
  const i = detectIndent(path);
  return typeof i === 'number' ? i : 2;
}

/** Surgically merge in the conclear entry, preserving comments/formatting. */
export function installMcpJsonc(spec: JsoncSpec): InstallResult {
  const source = readSource(spec.path);
  const errors: ParseError[] = [];
  const parsed = parse(source, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new Error(`Cannot parse JSONC config: ${spec.path} (${errors.length} error${errors.length > 1 ? 's' : ''})`);
  }

  const existing = parsed?.[spec.serversKey]?.[ENTRY_NAME];
  if (JSON.stringify(existing) === JSON.stringify(spec.entry)) {
    return { ok: true, action: `already installed in ${spec.path}` };
  }

  const edits = modify(
    source,
    [spec.serversKey, ENTRY_NAME],
    spec.entry,
    { formattingOptions: { tabSize: indentOf(spec.path), insertSpaces: true } },
  );
  const updated = applyEdits(source, edits);

  const backup = backupFile(spec.path);
  mkdirSync(dirname(spec.path), { recursive: true });
  writeFileSync(spec.path, updated, 'utf-8');

  return {
    ok: true,
    action: backup ? `updated ${spec.path} (comments preserved)` : `created ${spec.path}`,
    followUp: spec.followUp,
  };
}

export function uninstallMcpJsonc(spec: JsoncSpec): InstallResult {
  if (!fileExists(spec.path)) {
    return { ok: true, action: `not installed (no config at ${spec.path})` };
  }
  const source = readFileSync(spec.path, 'utf-8');
  const errors: ParseError[] = [];
  const parsed = parse(source, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new Error(`Cannot parse JSONC config: ${spec.path}`);
  }
  if (!parsed?.[spec.serversKey] || !(ENTRY_NAME in parsed[spec.serversKey])) {
    return { ok: true, action: `not installed in ${spec.path}` };
  }
  // Passing `undefined` to modify() removes the property.
  const edits = modify(source, [spec.serversKey, ENTRY_NAME], undefined, {
    formattingOptions: { tabSize: indentOf(spec.path), insertSpaces: true },
  });
  const updated = applyEdits(source, edits);

  backupFile(spec.path);
  writeFileSync(spec.path, updated, 'utf-8');
  return { ok: true, action: `removed from ${spec.path}`, followUp: spec.followUp };
}

export function statusMcpJsonc(spec: JsoncSpec): { installed: boolean; path: string } {
  if (!fileExists(spec.path)) return { installed: false, path: spec.path };
  const source = readFileSync(spec.path, 'utf-8');
  const errors: ParseError[] = [];
  const parsed = parse(source, errors, { allowTrailingComma: true });
  if (errors.length > 0) return { installed: false, path: spec.path };
  const servers = parsed?.[spec.serversKey];
  return { installed: !!(servers && ENTRY_NAME in servers), path: spec.path };
}
