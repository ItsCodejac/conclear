// Experimental, local-only recorder. Not installed or started by ConClear.
import { watch, constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { resolve, join, relative, dirname, isAbsolute, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { RecoveryStorage, policy } from './storage.mjs';
import { atomic, readSnapshot } from './persistence.mjs';
import { withStoreLock } from './control.mjs';
export { readSnapshot } from './persistence.mjs';

const compress = promisify(gzip);

const hash = data => createHash('sha256').update(data).digest('hex');
const inside = (parent, child) => child === parent || child.startsWith(parent + sep);
const excluded = new Set(['.git', 'node_modules', 'dist', '.DS_Store']);
const message = error => error instanceof Error ? error.message : String(error);


export class Recorder {
  constructor(project, store, { intervalMs = 1000, notifications = true, storageCheckpoint, maxBytes, maxSnapshots, retentionMode } = {}) {
    if (!Number.isInteger(intervalMs) || intervalMs < 20) throw new Error('intervalMs must be an integer >= 20');
    this.project = resolve(project);
    this.store = resolve(store);
    this.intervalMs = intervalMs;
    this.notifications = notifications;
    this.requestedPolicy = Object.fromEntries(Object.entries({ maxBytes, maxSnapshots, mode: retentionMode }).filter(([, value]) => value !== undefined));
    policy(this.requestedPolicy);
    // Test instrumentation only; no CLI flag, environment trigger, or AI hook.
    this.storageCheckpoint = storageCheckpoint;
    this.queue = Promise.resolve();
    this.dirty = new Set();
    this.fullScanPending = false;
    this.status = { state: 'starting', watcher: 'off', lastSuccessfulScan: null, lastSnapshot: null, failedScanCount: 0, recentFailures: [] };
  }

  async start() {
    this.project = await fs.realpath(this.project);
    if (!(await fs.stat(this.project)).isDirectory()) throw new Error('Project must be a directory');
    // Resolve the parent before creating anything; the store must stay outside the project.
    this.store = join(await fs.realpath(dirname(this.store)), this.store.split(sep).at(-1));
    if (inside(this.project, this.store) || inside(this.store, this.project)) throw new Error('Project and store must be separate trees');
    await fs.mkdir(this.store, { recursive: true, mode: 0o700 });
    if ((await fs.lstat(this.store)).isSymbolicLink()) throw new Error('Store cannot be a symlink');
    this.lock = join(this.store, 'writer.lock');
    // Serialize stale-lock reclamation. A crash during this short section fails
    // closed on restart: the acquisition directory requires manual inspection.
    const acquisition = join(this.store, 'acquiring-writer');
    await fs.mkdir(acquisition);
    try {
      try {
        await fs.writeFile(this.lock, String(process.pid), { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const pid = Number(await fs.readFile(this.lock, 'utf8'));
        if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid writer lock; inspect store before removing it');
        try { process.kill(pid, 0); throw new Error('Recovery store already has a live writer'); }
        catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
        await fs.unlink(this.lock);
        await fs.writeFile(this.lock, String(process.pid), { flag: 'wx', mode: 0o600 });
      }
    } finally { await fs.rmdir(acquisition); }
    this.ownsLock = true;
    try {
      const configPath = join(this.store, 'project.json');
      let config;
      try { config = JSON.parse(await fs.readFile(configPath, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (config && (config.version !== 1 || config.project !== this.project)) throw new Error('Store belongs to a different project or format');
      if (config && !config.retention && !Object.keys(this.requestedPolicy).length) throw new Error('Existing unbounded store requires explicit limits or retention mode before management is enabled');
      const retention = policy({ ...config?.retention, ...this.requestedPolicy });
      await atomic(configPath, JSON.stringify({ version: 1, project: this.project, retention }));
      await fs.mkdir(join(this.store, 'objects'), { recursive: true });
      await fs.mkdir(join(this.store, 'snapshots'), { recursive: true });
      this.storage = new RecoveryStorage(this.store, retention, readSnapshot, this.storageCheckpoint);
      let previous;
      try { previous = JSON.parse(await fs.readFile(join(this.store, 'status.json'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      this.status.failedScanCount = previous?.failedScanCount ?? 0;
      this.status.recentFailures = previous?.recentFailures ?? [];
      this.status.interruption = previous ? {
        since: previous.lastSuccessfulScan,
        resumedAt: new Date().toISOString(),
        previousState: previous.state,
        note: 'Changes overwritten while not observing cannot be recovered.',
      } : null;
      if (this.notifications) {
        try {
          this.watcher = watch(this.project, { recursive: true }, (_event, filename) => this.schedule('notification', filename));
          this.status.watcher = 'active';
          this.watcher.on('error', error => {
            this.status.watcher = 'failed';
            this.status.watcherError = message(error);
            this.watcher.close();
            this.schedule('watcher-error');
          });
        } catch (error) {
          this.status.watcher = 'failed';
          this.status.watcherError = message(error);
        }
      }
      await this.capture('baseline');
      this.ready = true;
      this.drain();
      this.timer = setInterval(() => this.schedule('reconciliation'), this.intervalMs);
      return this;
    } catch (error) { await this.stop(); throw error; }
  }

  schedule(reason, filename) {
    if (this.stopping) return;
    const name = filename?.toString();
    if (reason !== 'notification' || !name || isAbsolute(name) || name.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) {
      this.fullScanPending = true;
    } else if (!name.split(sep).some(part => excluded.has(part))) {
      this.dirty.add(name);
      if (this.dirty.size > 10000) { this.dirty.clear(); this.fullScanPending = true; }
    }
    this.drain();
  }

  drain() {
    if (!this.ready || this.stopping || this.scheduled || (!this.fullScanPending && !this.dirty.size)) return;
    if (Date.now() < (this.retryAfter ?? 0)) return;
    this.scheduled = true;
    const pending = this.queue.then(() => {
      const paths = this.fullScanPending ? undefined : [...this.dirty];
      this.fullScanPending = false;
      if (paths) this.dirty.clear();
      return this.scan(paths ? 'notification' : 'reconciliation', paths);
    });
    this.queue = pending.catch(() => {});
    pending.catch(() => {}).finally(() => {
      this.scheduled = false;
      // Events arriving during a scan survive for the next batch. Failed reads
      // are retried by subsequent events or reconciliation, without a busy loop.
      this.drain();
    });
  }

  capture(reason = 'manual') {
    if (this.stopping) return Promise.reject(new Error('Recorder stopped'));
    const pending = this.queue.then(() => this.scan(reason));
    this.queue = pending.catch(() => {});
    return pending;
  }

  async scan(reason, paths) {
    this.scanDepth = (this.scanDepth ?? 0) + 1;
    const outer = this.scanDepth === 1;
    const began = performance.now();
    const startedAt = new Date().toISOString();
    const entries = [];
    const skipped = [];
    let bytesRead = 0;
    let newObjectBytes = 0;
    try {
      if (outer) await this.storage.maintain();
      if (!this.inventory && this.storage.latestId) {
        const previous = await readSnapshot(join(this.store, 'snapshots', `${this.storage.latestId}.json`));
        this.inventory = { entries: previous.entries, skipped: previous.skipped };
        this.fingerprint = hash(JSON.stringify(this.inventory));
        this.status.lastSnapshot = previous.id;
      }
      const targeted = paths && this.inventory;
      const refreshed = new Set();
      let lastYield = performance.now();
      const serviceChanges = async () => {
        if (targeted || !this.ready || this.stopping || !this.dirty.size) return;
        const pending = [...this.dirty];
        this.dirty.clear();
        // Run one batch cooperatively between file reads. No simultaneous
        // inventory publication, and no waiting for the whole walk to finish.
        const previousInventory = this.inventory;
        try {
          await this.scan('notification', pending);
        } catch { /* Failure history is retained; full reconciliation continues. */ }
        // A batch may publish successfully and then fail writing status. Its
        // committed inventory must still win over this walk's earlier reads.
        if (this.inventory !== previousInventory) for (const path of pending) refreshed.add(path);
        lastYield = performance.now();
      };
      const changedRoots = targeted ? [...new Set(paths)].sort().filter((path, i, all) => !all.slice(0, i).some(parent => path.startsWith(parent + sep))) : null;
      if (targeted) {
        const retained = path => !changedRoots.some(root => path === root || path.startsWith(root + sep));
        entries.push(...this.inventory.entries.filter(entry => retained(entry.path)));
        skipped.push(...this.inventory.skipped.filter(entry => retained(entry.path)));
      }
      const walk = async directory => {
        const names = (await fs.readdir(directory)).sort();
        for (const name of names) {
          await visit(join(directory, name));
          if (performance.now() - lastYield >= 20) await serviceChanges();
        }
      };
      const visit = async path => {
          const name = path.split(sep).at(-1);
          const local = relative(this.project, path);
          if (excluded.has(name)) { skipped.push({ path: local, reason: 'excluded' }); return; }
          const info = await fs.lstat(path);
          if (info.isDirectory()) { await walk(path); return; }
          if (!info.isFile()) { skipped.push({ path: local, reason: 'symlink-or-special-file' }); return; }
          if (info.size > 16 * 1024 * 1024) { skipped.push({ path: local, reason: 'over-16-MiB' }); return; }
          const file = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
          let data, after;
          try {
            const before = await file.stat();
            if (!before.isFile() || before.size > 16 * 1024 * 1024) throw new Error(`File changed before read: ${local}`);
            data = await file.readFile();
            after = await file.stat();
            const current = await fs.lstat(path);
            if (before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || current.ino !== after.ino || current.ctimeMs !== after.ctimeMs) {
              throw new Error(`File changed during read: ${local}`);
            }
          } finally { await file.close(); }
          bytesRead += data.length;
          const digest = hash(data);
          const object = join(this.store, 'objects', digest);
          try {
            if (hash(await fs.readFile(object)) !== digest) throw new Error(`Corrupt recovery object: ${digest}`);
          } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            this.storage.reserve(data.length);
            await atomic(object, data, this.storageCheckpoint);
            newObjectBytes += data.length;
          }
          entries.push({ path: local, hash: digest, bytes: data.length, mode: after.mode & 0o777 });
      };
      if (targeted) {
        for (const local of changedRoots) {
          // Resolve ancestors without traversing a symlink introduced since the
          // baseline. Reconciliation will account for the changed ancestor.
          let parent = dirname(join(this.project, local));
          while (parent !== this.project) {
            if (!(await fs.lstat(parent)).isDirectory()) throw new Error(`Changed ancestor requires reconciliation: ${local}`);
            parent = dirname(parent);
          }
          try { await visit(join(this.project, local)); }
          catch (error) {
            // Only absence of the target itself establishes removal. A missing
            // descendant during traversal makes this batch fail conservatively.
            if (error.code !== 'ENOENT') throw error;
            const stillExists = await fs.lstat(join(this.project, local)).then(() => true, check => {
              if (check.code !== 'ENOENT') throw check;
              return false;
            });
            if (stillExists) throw error;
          }
        }
      } else await walk(this.project);
      if (!targeted) {
        await serviceChanges();
        if (refreshed.size) {
          const affected = path => [...refreshed].some(root => path === root || path.startsWith(root + sep));
          // A file read early in this walk may have been captured again while
          // yielding. Never overwrite that newer observation with the old read.
          const latest = this.inventory;
          const mergedEntries = entries.filter(entry => !affected(entry.path));
          const mergedSkipped = skipped.filter(entry => !affected(entry.path));
          entries.splice(0, entries.length, ...mergedEntries, ...latest.entries.filter(entry => affected(entry.path)));
          skipped.splice(0, skipped.length, ...mergedSkipped, ...latest.skipped.filter(entry => affected(entry.path)));
        }
      }
      entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      skipped.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      const fingerprint = hash(JSON.stringify({ entries, skipped }));
      let snapshot = null;
      if (fingerprint !== this.fingerprint) {
        const id = `${this.storage.nextTimestamp()}-${randomUUID()}`;
        snapshot = { version: 1, id, project: this.project, startedAt, finishedAt: new Date().toISOString(), reason, scope: targeted ? 'changed-paths' : 'full-tree', atomic: false, entries, skipped };
        const inventoryBytes = Buffer.from(JSON.stringify({ entries, skipped }));
        if (inventoryBytes.length > 64 * 1024 * 1024) throw new Error('Inventory exceeds the 64 MiB manifest limit');
        const inventory = (await compress(inventoryBytes)).toString('base64');
        const encoded = JSON.stringify({ ...snapshot, entries: undefined, skipped: undefined, inventoryEncoding: 'gzip-base64', inventory });
        this.storage.reserve(Buffer.byteLength(encoded), true);
        await atomic(join(this.store, 'snapshots', `${id}.json`), encoded, this.storageCheckpoint);
        this.storage.count++;
        this.status.lastSnapshot = id;
        this.fingerprint = fingerprint;
      }
      this.inventory = { entries, skipped };
      if (outer) await this.storage.maintain();
      this.retryAfter = 0;
      this.status.retryAfter = null;
      this.status = { ...this.status, state: skipped.length || this.status.watcher === 'failed' ? 'limited' : 'observing', lastSuccessfulScan: new Date().toISOString(), lastFullScan: targeted ? this.status.lastFullScan : new Date().toISOString(), lastError: null, skipped, metrics: { scope: targeted ? 'changed-paths' : 'full-tree', durationMs: performance.now() - began, bytesRead, newObjectBytes, files: entries.length } };
      this.status.storage = this.storage.status();
      await atomic(join(this.store, 'status.json'), JSON.stringify(this.status));
      return snapshot;
    } catch (error) {
      const full = error.code === 'RECOVERY_STORAGE_FULL';
      this.status.state = full ? 'storage-full' : 'error';
      if (full) this.retryAfter = Date.now() + 30000;
      this.status.retryAfter = full ? new Date(this.retryAfter).toISOString() : null;
      this.status.storage = this.storage?.status();
      this.status.lastError = { at: new Date().toISOString(), message: message(error), ...(full ? { resource: error.resource } : {}) };
      this.status.failedScanCount++;
      this.status.recentFailures = [...this.status.recentFailures, this.status.lastError].slice(-10);
      await atomic(join(this.store, 'status.json'), JSON.stringify(this.status)).catch(() => {});
      throw error;
    } finally { this.scanDepth--; }
  }

  async stop() {
    this.stopping = true;
    clearInterval(this.timer);
    this.watcher?.close();
    await this.queue;
    if (this.ownsLock) {
      this.status.state = 'stopped';
      try { await atomic(join(this.store, 'status.json'), JSON.stringify(this.status)); }
      finally { await fs.unlink(this.lock); this.ownsLock = false; }
    }
  }
}

export async function restore(store, id, destination, { checkpoint } = {}) {
  if (!/^\d+-[a-f0-9-]+$/.test(id)) throw new Error('Invalid snapshot id');
  store = await fs.realpath(store);
  return withStoreLock(store, () => restoreUnlocked(store, id, destination, checkpoint));
}

async function restoreUnlocked(store, id, destination, checkpoint) {
  const snapshot = await readSnapshot(join(store, 'snapshots', `${id}.json`));
  if (snapshot.version !== 1 || snapshot.id !== id || !Array.isArray(snapshot.entries)) throw new Error('Invalid snapshot');
  destination = join(await fs.realpath(dirname(resolve(destination))), resolve(destination).split(sep).at(-1));
  if (inside(store, destination) || inside(destination, store) || inside(snapshot.project, destination) || inside(destination, snapshot.project)) throw new Error('Restore destination must be separate from project and store');
  const seen = new Set();
  // Validate all paths and objects before creating a destination. Never overwrite a workspace.
  for (const entry of snapshot.entries) {
    if (typeof entry.path !== 'string' || !entry.path || isAbsolute(entry.path) || entry.path.split(/[\\/]/).some(part => !part || part === '.' || part === '..') || seen.has(entry.path) || !/^[a-f0-9]{64}$/.test(entry.hash)) throw new Error('Unsafe snapshot entry');
    seen.add(entry.path);
    if (hash(await fs.readFile(join(store, 'objects', entry.hash))) !== entry.hash) throw new Error('Corrupt recovery object');
  }
  await checkpoint?.('verified');
  await fs.mkdir(destination, { mode: 0o700 });
  for (const entry of snapshot.entries) {
    const path = join(destination, entry.path);
    await fs.mkdir(dirname(path), { recursive: true });
    const data = await fs.readFile(join(store, 'objects', entry.hash));
    if (hash(data) !== entry.hash) throw new Error('Corrupt recovery object');
    await fs.writeFile(path, data, { flag: 'wx', mode: entry.mode & 0o777 });
  }
  return { destination, files: snapshot.entries.length, skipped: snapshot.skipped, atomic: false };
}
