/**
 * Update-check tests. The network and clock are injected so these run fully
 * offline: fetchLatest is a stub, `now` is a fixed timestamp, and the cache
 * lives in a temp dir. The real registry fetch is never exercised here.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isNewerVersion, getCurrentVersion, getUpdateStatus } from '../src/update-check.js';

const NOW = Date.parse('2026-07-19T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('isNewerVersion', () => {
  it('detects newer patch / minor / major', () => {
    expect(isNewerVersion('0.4.4', '0.4.3')).toBe(true);
    expect(isNewerVersion('0.5.0', '0.4.9')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true);
  });

  it('compares numerically, not lexically', () => {
    expect(isNewerVersion('0.10.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('0.9.9', '0.10.0')).toBe(false);
  });

  it('equal or older is not newer', () => {
    expect(isNewerVersion('0.4.3', '0.4.3')).toBe(false);
    expect(isNewerVersion('0.4.2', '0.4.3')).toBe(false);
  });

  it('malformed versions are never "newer"', () => {
    expect(isNewerVersion('', '0.4.3')).toBe(false);
    expect(isNewerVersion('not-a-version', '0.4.3')).toBe(false);
  });
});

describe('getCurrentVersion', () => {
  it('reads a semver from package.json', () => {
    expect(getCurrentVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('getUpdateStatus', () => {
  let dir: string;
  let cachePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'conclear-update-'));
    cachePath = join(dir, 'update-check.json');
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function opts(overrides: Record<string, unknown> = {}) {
    return {
      currentVersion: '0.4.3',
      cachePath,
      now: NOW,
      env: {},
      fetchLatest: async () => { throw new Error('fetchLatest should not be called'); },
      ...overrides,
    };
  }

  it('returns null when CONCLEAR_NO_UPDATE_CHECK is set', async () => {
    const status = await getUpdateStatus(opts({ env: { CONCLEAR_NO_UPDATE_CHECK: '1' } }));
    expect(status).toBeNull();
  });

  it('returns null when CI is set', async () => {
    const status = await getUpdateStatus(opts({ env: { CI: 'true' } }));
    expect(status).toBeNull();
  });

  it('uses a fresh cache without fetching', async () => {
    writeFileSync(cachePath, JSON.stringify({
      latest: '0.5.0',
      checkedAt: new Date(NOW - DAY / 2).toISOString(),
    }));
    const status = await getUpdateStatus(opts());
    expect(status).toEqual({ current: '0.4.3', latest: '0.5.0', updateAvailable: true });
  });

  it('reports no update when cached latest equals current', async () => {
    writeFileSync(cachePath, JSON.stringify({
      latest: '0.4.3',
      checkedAt: new Date(NOW - DAY / 2).toISOString(),
    }));
    const status = await getUpdateStatus(opts());
    expect(status).toEqual({ current: '0.4.3', latest: '0.4.3', updateAvailable: false });
  });

  it('fetches when the cache is stale and rewrites it', async () => {
    writeFileSync(cachePath, JSON.stringify({
      latest: '0.4.3',
      checkedAt: new Date(NOW - 2 * DAY).toISOString(),
    }));
    const status = await getUpdateStatus(opts({ fetchLatest: async () => '0.6.0' }));
    expect(status).toEqual({ current: '0.4.3', latest: '0.6.0', updateAvailable: true });

    const cache = JSON.parse(readFileSync(cachePath, 'utf-8'));
    expect(cache.latest).toBe('0.6.0');
    expect(Date.parse(cache.checkedAt)).toBe(NOW);
  });

  it('fetches and writes the cache when no cache exists yet', async () => {
    const status = await getUpdateStatus(opts({ fetchLatest: async () => '0.4.4' }));
    expect(status).toEqual({ current: '0.4.3', latest: '0.4.4', updateAvailable: true });
    expect(existsSync(cachePath)).toBe(true);
  });

  it('falls back to a stale cache value when the fetch fails', async () => {
    writeFileSync(cachePath, JSON.stringify({
      latest: '0.5.0',
      checkedAt: new Date(NOW - 3 * DAY).toISOString(),
    }));
    const status = await getUpdateStatus(opts({ fetchLatest: async () => { throw new Error('offline'); } }));
    expect(status).toEqual({ current: '0.4.3', latest: '0.5.0', updateAvailable: true });
  });

  it('never throws when the fetch fails and there is no cache', async () => {
    const status = await getUpdateStatus(opts({ fetchLatest: async () => { throw new Error('offline'); } }));
    expect(status).toEqual({ current: '0.4.3', latest: null, updateAvailable: false });
  });

  it('ignores a garbage version from the fetch', async () => {
    const status = await getUpdateStatus(opts({ fetchLatest: async () => '<html>rate limited</html>' }));
    expect(status).toEqual({ current: '0.4.3', latest: null, updateAvailable: false });
  });

  it('tolerates a corrupt cache file', async () => {
    writeFileSync(cachePath, 'not json{{{');
    const status = await getUpdateStatus(opts({ fetchLatest: async () => '0.5.0' }));
    expect(status).toEqual({ current: '0.4.3', latest: '0.5.0', updateAvailable: true });
  });
});
