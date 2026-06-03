/**
 * Shared secret-scanning primitives used by every adapter that supports
 * `scanSecrets` / `redactSecrets`.
 *
 * The pattern table and the redact / context helpers live here so each
 * adapter only has to bring its own iteration strategy — JSONL line by line
 * for Claude, a JSON array for Cline, a Gemini messages array, etc.
 */

import type { SecretFinding } from './types.js';

export interface SecretPattern {
  type: string;
  severity: 'high' | 'medium' | 'low';
  regex: RegExp;
  /** Patterns that need a nearby keyword to avoid false positives (e.g. AWS secret). */
  nearbyKeyword?: RegExp;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  // High severity
  { type: 'api_key',      severity: 'high', regex: /sk-(?:proj-|ant-)?[a-zA-Z0-9]{20,}/g },
  { type: 'aws_key',      severity: 'high', regex: /AKIA[A-Z0-9]{16}/g },
  { type: 'aws_secret',   severity: 'high', regex: /[A-Za-z0-9/+=]{40}/g, nearbyKeyword: /aws_secret|AWS_SECRET/i },
  { type: 'private_key',  severity: 'high', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { type: 'github_token', severity: 'high', regex: /(?:ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36,}|ghs_[a-zA-Z0-9]{36,}|github_pat_[a-zA-Z0-9_]{20,})/g },
  { type: 'bearer_token', severity: 'high', regex: /Bearer [a-zA-Z0-9._-]{20,}/g },

  // Medium severity
  { type: 'env_credential', severity: 'medium', regex: /(?:PASSWORD|SECRET|TOKEN|API_KEY)\s*=\s*\S+/gi },
  { type: 'database_url',   severity: 'medium', regex: /(?:postgres|mysql|mongodb):\/\/[^\s"']+:[^\s"']+@[^\s"']+/g },
  { type: 'webhook_token',  severity: 'medium', regex: /https:\/\/[^\s"']*(?:hooks|webhook)[^\s"']*\/[a-zA-Z0-9_-]{20,}/gi },

  // Low severity
  { type: 'env_file',         severity: 'low', regex: /(?:read|write|load|cat|source)\s+[^\s]*\.env\b/gi },
  { type: 'sensitive_path',   severity: 'low', regex: /(?:\/|\\)(?:credentials|secrets|keys)(?:\/|\\)/gi },
];

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

/** Redact a secret value: show first 4 and last 4 chars with **** in between. */
export function redactSecret(value: string): string {
  if (value.length <= 8) return '****';
  return value.slice(0, 4) + '****' + value.slice(-4);
}

/** Extract a redacted context window around a match position in text. */
export function extractContext(text: string, matchStart: number, matchEnd: number, secret: string): string {
  const windowSize = 40;
  const start = Math.max(0, matchStart - windowSize);
  const end = Math.min(text.length, matchEnd + windowSize);
  let ctx = text.slice(start, end).replace(/\n/g, ' ').trim();
  ctx = ctx.replace(secret, redactSecret(secret));
  if (start > 0) ctx = '...' + ctx;
  if (end < text.length) ctx = ctx + '...';
  if (ctx.length > 120) ctx = ctx.slice(0, 117) + '...';
  return ctx;
}

/**
 * Scan a block of text for every supported secret pattern. Caller supplies a
 * `unitNumber` (typically a line number or message index) that gets attached
 * to each finding. Pass `seen` across multiple calls if you want global
 * dedupe; otherwise findings within a single text are deduped by pattern+value.
 */
export function scanText(
  text: string,
  unitNumber: number,
  seen: Set<string>,
  timestamp?: string,
): SecretFinding[] {
  const out: SecretFinding[] = [];
  if (!text) return out;

  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text)) !== null) {
      const matched = match[0];
      if (pattern.nearbyKeyword) {
        const wStart = Math.max(0, match.index - 200);
        const wEnd = Math.min(text.length, match.index + matched.length + 200);
        if (!pattern.nearbyKeyword.test(text.slice(wStart, wEnd))) continue;
      }
      const redacted = redactSecret(matched);
      const key = `${pattern.type}:${redacted}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        type: pattern.type,
        pattern: redacted,
        context: extractContext(text, match.index, match.index + matched.length, matched),
        lineNumber: unitNumber,
        timestamp,
        severity: pattern.severity,
      });
    }
  }
  return out;
}

/** Sort findings high → medium → low for consistent UI ordering. */
export function sortFindings(findings: SecretFinding[]): SecretFinding[] {
  return findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export interface RedactFilter { lineNumber?: number; type?: string }

/**
 * Apply redaction to a single text block. Returns the rewritten text and the
 * number of replacements. Use the `filter.type` field to restrict to one
 * pattern (per-finding redact); pass `null` for full redact.
 */
export function redactText(text: string, filter: RedactFilter | null): { text: string; replaced: number } {
  let replaced = 0;
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    if (filter?.type && filter.type !== pattern.type) continue;
    pattern.regex.lastIndex = 0;
    out = out.replace(pattern.regex, (match, _g, offset: number) => {
      if (pattern.nearbyKeyword) {
        const wStart = Math.max(0, offset - 200);
        const wEnd = Math.min(out.length, offset + match.length + 200);
        if (!pattern.nearbyKeyword.test(out.slice(wStart, wEnd))) return match;
      }
      replaced++;
      return '****REDACTED****';
    });
  }
  return { text: out, replaced };
}
