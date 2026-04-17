// ---------------------------------------------------------------------------
// Time formatting utilities
// ---------------------------------------------------------------------------

/** Pad a number to 2 digits */
function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

/** Format a timestamp as 24h time: "15:08:30" */
export function formatTime(ts: string | number): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** Format a timestamp as short date + 24h time: "Apr 17, 15:08" */
export function formatDateTime(ts: string | number): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const month = d.toLocaleString('en-US', { month: 'short' });
  return `${month} ${d.getDate()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Format a timestamp as relative time: "3m ago", "4d ago" */
export function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// Project name decoding
// ---------------------------------------------------------------------------

/**
 * Decode an encoded Claude project path into a human-readable project name.
 *
 * Examples:
 *   "-Volumes-4tbCache--Projects-VEESTY"       -> "VEESTY"
 *   "-Volumes-2TBSamsung-hunt3r"               -> "hunt3r"
 *   "-Users-cojac-rollbit-side-bets"           -> "rollbit-side-bets"
 *   "-Users-cojac"                             -> "Home"
 *   "-Users-cojac--claude"                     -> ".claude"
 *   "-Volumes-4tbCache-code4rena"              -> "code4rena"
 *   "-Volumes-4tbCache-hells-kitchen"          -> "hells-kitchen"
 */

const PATH_PREFIXES = [
  // /Volumes/<drive>/Projects/ variants (double-dash encodes the slash before Projects)
  /^-Volumes-[^-]+-+Projects-/,
  // /Users/<user>/Projects/ variants
  /^-Users-[^-]+-+Projects-/,
  // /Volumes/<drive>/ (single segment drive name)
  /^-Volumes-[^-]+-/,
  // /Users/<user>/
  /^-Users-[^-]+-/,
];

// Bare home directory pattern: exactly "-Users-<user>" with nothing after
const BARE_HOME = /^-Users-[^-]+$/;

export function decodeProjectName(raw: string): string {
  // Bare home directory
  if (BARE_HOME.test(raw)) return 'Home';

  let name = raw;
  for (const prefix of PATH_PREFIXES) {
    const match = name.match(prefix);
    if (match) {
      name = name.slice(match[0].length);
      break;
    }
  }

  // After prefix stripping, a leading dash means the next segment was dot-prefixed
  // (e.g. prefix consumed "-Users-cojac-" from "-Users-cojac--claude", leaving "-claude" = ".claude")
  if (name.startsWith('-')) {
    name = '.' + name.slice(1);
  }

  return name || raw;
}
