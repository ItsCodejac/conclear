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
