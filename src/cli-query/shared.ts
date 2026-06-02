/**
 * Helpers shared by all CLI commands: arg parsing, formatting, project-dir
 * decoding. Adapter routing comes from src/server/adapters/registry.ts.
 */

export function getFlag(args: string[], name: string): boolean {
  const idx = args.indexOf(name);
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

export function getOption(args: string[], name: string, defaultValue?: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return defaultValue;
  if (idx + 1 >= args.length) return defaultValue;
  const val = args[idx + 1];
  args.splice(idx, 2);
  return val;
}

export function formatDate(ts: number | string | undefined): string {
  if (!ts) return '-';
  const d = new Date(typeof ts === 'string' ? ts : ts);
  if (isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + '...';
}

/** Claude stores project dirs as "-Volumes-...-ConClear"; return the last segment. */
export function decodeProjectDir(encoded: string): string {
  if (!encoded.startsWith('-')) return encoded;
  const parts = encoded.split('-').filter(Boolean);
  return parts[parts.length - 1] || encoded;
}
