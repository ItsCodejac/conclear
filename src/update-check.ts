/**
 * Update check — compares the installed version against the latest published
 * to npm, so the CLI and web UI can nudge users to upgrade (an old ConClear
 * means an old secret-pattern table).
 *
 * Privacy: the only network call is a package-name lookup against
 * registry.npmjs.org, cached in ~/.conclear/update-check.json for 24 hours.
 * No session data is ever sent. Disabled entirely when
 * CONCLEAR_NO_UPDATE_CHECK or CI is set in the environment.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface UpdateStatus {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
}

interface UpdateCache {
  latest: string;
  checkedAt: string;
}

export interface UpdateCheckOptions {
  currentVersion?: string;
  cachePath?: string;
  ttlMs?: number;
  /** Injected for tests; defaults to the npm registry lookup. */
  fetchLatest?: () => Promise<string>;
  env?: NodeJS.ProcessEnv;
  now?: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CACHE_PATH = join(homedir(), '.conclear', 'update-check.json');
const FETCH_TIMEOUT_MS = 1500;

const SEMVER = /^(\d+)\.(\d+)\.(\d+)/;

/** True when `latest` is a strictly newer x.y.z than `current`. Malformed input is never newer. */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = SEMVER.exec(latest);
  const b = SEMVER.exec(current);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) {
    const diff = Number(a[i]) - Number(b[i]);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/** Read our own version from package.json (dist/ and src/ both sit one level below it). */
export function getCurrentVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, '..', 'package.json'), join(here, '..', '..', 'package.json')];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const version = JSON.parse(readFileSync(p, 'utf-8')).version;
      if (typeof version === 'string' && SEMVER.test(version)) return version;
    } catch { /* fall through */ }
  }
  return '0.0.0';
}

async function fetchLatestFromNpm(): Promise<string> {
  const res = await fetch('https://registry.npmjs.org/conclear/latest', {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`registry responded ${res.status}`);
  return (await res.json() as { version: string }).version;
}

function readCache(path: string): UpdateCache | null {
  try {
    const cache = JSON.parse(readFileSync(path, 'utf-8'));
    if (typeof cache?.latest === 'string' && typeof cache?.checkedAt === 'string') return cache;
  } catch { /* missing or corrupt — treat as no cache */ }
  return null;
}

/**
 * Resolve the current update status. Uses the cache when fresh; otherwise
 * fetches (bounded, never throws) and rewrites the cache, falling back to a
 * stale cache value when offline. Returns null when the check is disabled.
 */
export async function getUpdateStatus(options: UpdateCheckOptions = {}): Promise<UpdateStatus | null> {
  const env = options.env ?? process.env;
  if (env.CONCLEAR_NO_UPDATE_CHECK || env.CI) return null;

  const current = options.currentVersion ?? getCurrentVersion();
  const cachePath = options.cachePath ?? DEFAULT_CACHE_PATH;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now();
  const fetchLatest = options.fetchLatest ?? fetchLatestFromNpm;

  const cache = readCache(cachePath);
  let latest: string | null = null;

  if (cache && now - Date.parse(cache.checkedAt) < ttlMs) {
    latest = cache.latest;
  } else {
    try {
      const fetched = await fetchLatest();
      if (SEMVER.test(fetched)) {
        latest = fetched;
        try {
          mkdirSync(dirname(cachePath), { recursive: true });
          writeFileSync(cachePath, JSON.stringify({ latest, checkedAt: new Date(now).toISOString() }));
        } catch { /* cache write failure is not worth surfacing */ }
      }
    } catch { /* offline or registry down */ }
    if (latest === null && cache) latest = cache.latest;
  }

  return {
    current,
    latest,
    updateAvailable: latest !== null && isNewerVersion(latest, current),
  };
}

/** CLI helper: one line on stderr when an update exists. Never throws, never blocks long. */
export async function notifyUpdateOnStderr(): Promise<void> {
  try {
    const status = await getUpdateStatus();
    if (status?.updateAvailable) {
      process.stderr.write(
        `\nUpdate available ${status.current} → ${status.latest} · run: npm install -g conclear\n`,
      );
    }
  } catch { /* never let the nudge break a real command */ }
}
