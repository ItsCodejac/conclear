// Experimental, local-only recorder. Not installed or started by ConClear.
import { watch, constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { resolve, join, relative, dirname, isAbsolute, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const hash = data => createHash('sha256').update(data).digest('hex');
const inside = (parent, child) => child === parent || child.startsWith(parent + sep);
const excluded = new Set(['.git', 'node_modules', 'dist', '.DS_Store']);
const message = error => error instanceof Error ? error.message : String(error);

async function atomic(path, data) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  const handle = await fs.open(tmp, 'wx', 0o600);
  try { await handle.writeFile(data); await handle.sync(); }
  finally { await handle.close(); }
  await fs.rename(tmp, path);
  const dir = await fs.open(dirname(path), 'r');
  try { await dir.sync(); } finally { await dir.close(); }
}

export class Recorder {
  constructor(project, store, { intervalMs = 1000, notifications = true } = {}) {
    if (!Number.isInteger(intervalMs) || intervalMs < 20) throw new Error('intervalMs must be an integer >= 20');
    this.project = resolve(project);
    this.store = resolve(store);
    this.intervalMs = intervalMs;
    this.notifications = notifications;
    this.queue = Promise.resolve();
    this.status = { state: 'starting', watcher: 'off', lastSuccessfulScan: null, lastSnapshot: null };
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
      if (!config) await atomic(configPath, JSON.stringify({ version: 1, project: this.project }));
      await fs.mkdir(join(this.store, 'objects'), { recursive: true });
      await fs.mkdir(join(this.store, 'snapshots'), { recursive: true });
      let previous;
      try { previous = JSON.parse(await fs.readFile(join(this.store, 'status.json'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      this.status.interruption = previous ? {
        since: previous.lastSuccessfulScan,
        resumedAt: new Date().toISOString(),
        previousState: previous.state,
        note: 'Changes overwritten while not observing cannot be recovered.',
      } : null;
      if (this.notifications) {
        try {
          this.watcher = watch(this.project, { recursive: true }, () => this.schedule('notification'));
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
      this.timer = setInterval(() => this.schedule('reconciliation'), this.intervalMs);
      return this;
    } catch (error) { await this.stop(); throw error; }
  }

  schedule(reason) {
    if (this.stopping || this.scheduled) return;
    this.scheduled = true;
    // One pending scan at a time; notifications are hints, not a write journal.
    this.capture(reason).catch(() => {}).finally(() => { this.scheduled = false; });
  }

  capture(reason = 'manual') {
    if (this.stopping) return Promise.reject(new Error('Recorder stopped'));
    const pending = this.queue.then(() => this.scan(reason));
    this.queue = pending.catch(() => {});
    return pending;
  }

  async scan(reason) {
    const began = performance.now();
    const startedAt = new Date().toISOString();
    const entries = [];
    const skipped = [];
    let bytesRead = 0;
    let newObjectBytes = 0;
    try {
      const walk = async directory => {
        const names = (await fs.readdir(directory)).sort();
        for (const name of names) {
          const path = join(directory, name);
          const local = relative(this.project, path);
          if (excluded.has(name)) { skipped.push({ path: local, reason: 'excluded' }); continue; }
          const info = await fs.lstat(path);
          if (info.isDirectory()) { await walk(path); continue; }
          if (!info.isFile()) { skipped.push({ path: local, reason: 'symlink-or-special-file' }); continue; }
          if (info.size > 16 * 1024 * 1024) { skipped.push({ path: local, reason: 'over-16-MiB' }); continue; }
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
            await atomic(object, data);
            newObjectBytes += data.length;
          }
          entries.push({ path: local, hash: digest, bytes: data.length, mode: after.mode & 0o777 });
        }
      };
      await walk(this.project);
      const fingerprint = hash(JSON.stringify({ entries, skipped }));
      let snapshot = null;
      if (fingerprint !== this.fingerprint) {
        const id = `${Date.now()}-${randomUUID()}`;
        snapshot = { version: 1, id, project: this.project, startedAt, finishedAt: new Date().toISOString(), reason, atomic: false, entries, skipped };
        await atomic(join(this.store, 'snapshots', `${id}.json`), JSON.stringify(snapshot));
        this.status.lastSnapshot = id;
        this.fingerprint = fingerprint;
      }
      this.status = { ...this.status, state: skipped.length || this.status.watcher === 'failed' ? 'limited' : 'observing', lastSuccessfulScan: new Date().toISOString(), lastError: null, skipped, metrics: { durationMs: performance.now() - began, bytesRead, newObjectBytes, files: entries.length } };
      await atomic(join(this.store, 'status.json'), JSON.stringify(this.status));
      return snapshot;
    } catch (error) {
      this.status.state = 'error';
      this.status.lastError = { at: new Date().toISOString(), message: message(error) };
      await atomic(join(this.store, 'status.json'), JSON.stringify(this.status)).catch(() => {});
      throw error;
    }
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

export async function restore(store, id, destination) {
  if (!/^\d+-[a-f0-9-]+$/.test(id)) throw new Error('Invalid snapshot id');
  store = await fs.realpath(store);
  const snapshot = JSON.parse(await fs.readFile(join(store, 'snapshots', `${id}.json`), 'utf8'));
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
