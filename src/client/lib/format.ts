/**
 * Formatters used throughout the UI.
 *
 * Ported verbatim from the design's lib.jsx so the visual rhythm of numbers
 * (relative time, byte units, integer abbreviation) matches the design.
 */

export const KB = 1024;
export const MB = 1024 * 1024;

export function fmtBytes(b: number | null | undefined): string {
  if (b == null) return '—';
  if (b < 1024) return `${b} B`;
  if (b < MB) return `${(b / KB).toFixed(1)} KB`;
  if (b < 1024 * MB) return `${(b / MB).toFixed(1)} MB`;
  return `${(b / (1024 * MB)).toFixed(2)} GB`;
}

export function fmtBytesShort(b: number | null | undefined): string {
  if (b == null) return '—';
  if (b < MB) return `${Math.round(b / KB)}K`;
  if (b < 1024 * MB) return `${(b / MB).toFixed(b < 10 * MB ? 1 : 0)}M`;
  return `${(b / (1024 * MB)).toFixed(1)}G`;
}

export function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${n}`;
}

export function relTime(ts: number): string {
  const d = Date.now() - ts;
  const m = 60e3, h = 3600e3, day = 86400e3;
  if (d < m) return 'just now';
  if (d < h) return `${Math.floor(d / m)}m ago`;
  if (d < day) return `${Math.floor(d / h)}h ago`;
  if (d < 7 * day) return `${Math.floor(d / day)}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function clsx(...a: Array<string | false | null | undefined>): string {
  return a.filter(Boolean).join(' ');
}

export function sevColor(s: string | null | undefined): string {
  return s === 'high' ? 'var(--danger)' : s === 'medium' ? 'var(--warn)' : 'var(--muted2)';
}

/** Strip Claude's encoded project dir prefix and return the last meaningful segment. */
export function decodeProject(encoded: string): string {
  if (!encoded.startsWith('-')) return encoded;
  const parts = encoded.split('-').filter(Boolean);
  return parts[parts.length - 1] || encoded;
}
