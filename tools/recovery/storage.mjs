import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const DEFAULT_POLICY = { maxBytes: 512 * 1024 * 1024, maxSnapshots: 200 };
export function policy(options) {
  const result = { ...DEFAULT_POLICY, ...options };
  if (!Number.isSafeInteger(result.maxBytes) || result.maxBytes < 1024) throw new Error('maxBytes must be an integer >= 1024');
  if (!Number.isSafeInteger(result.maxSnapshots) || result.maxSnapshots < 2) throw new Error('maxSnapshots must be an integer >= 2');
  return result;
}
export class StorageFull extends Error {
  constructor() { super('Recovery payload budget exhausted; existing retained snapshots are preserved'); this.code = 'RECOVERY_STORAGE_FULL'; }
}
async function syncDirectory(path) {
  const handle = await fs.open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

// Called only between outer scans, never while a yielded scan has staged objects.
export class RecoveryStorage {
  constructor(store, limits, readSnapshot, checkpoint) {
    this.store = store;
    this.policy = policy(limits);
    this.readSnapshot = readSnapshot;
    this.checkpoint = checkpoint;
    this.bytes = 0;
    this.count = 0;
    this.sequence = 0;
    this.force = true;
  }

  reserve(bytes) {
    if (this.bytes + bytes > this.policy.maxBytes) { this.force = true; throw new StorageFull(); }
    // Reserve the entire temporary payload before writing, including on failure.
    // A later maintenance pass recomputes actual usage and removes orphan temps.
    this.bytes += bytes;
  }

  nextTimestamp() {
    this.sequence = Math.max(Date.now(), this.sequence + 1);
    return this.sequence;
  }

  async maintain() {
    if (!this.force && this.count <= this.policy.maxSnapshots && Date.now() - this.lastMaintenance < 30000) return;
    const objectsDir = join(this.store, 'objects'), snapshotsDir = join(this.store, 'snapshots');
    const files = [];
    for (const dir of [objectsDir, snapshotsDir]) {
      for (const name of await fs.readdir(dir)) {
        const path = join(dir, name), info = await fs.lstat(path);
        if (!info.isFile()) throw new Error('Unexpected non-file in recovery payload store');
        const base = name.replace(/\.[a-f0-9-]+\.tmp$/, '');
        const temporary = base !== name;
        if (!(dir === objectsDir ? /^[a-f0-9]{64}$/.test(base) : /^\d+-[a-f0-9-]+\.json$/.test(base))) throw new Error('Unexpected file in recovery payload store');
        files.push({ path, name, bytes: info.size, temporary, object: dir === objectsDir });
      }
    }
    const objects = new Map(files.filter(file => file.object && !file.temporary).map(file => [file.name, file]));
    const points = [];
    // Validate every published point before any deletion. Malformed or missing
    // references stop maintenance rather than guessing which bytes are disposable.
    for (const file of files.filter(file => !file.object && !file.temporary)) {
      const snapshot = await this.readSnapshot(file.path);
      if (snapshot.version !== 1 || `${snapshot.id}.json` !== file.name || !Array.isArray(snapshot.entries)) throw new Error('Invalid snapshot during retention');
      const sequence = Number(snapshot.id.split('-')[0]);
      if (!Number.isSafeInteger(sequence)) throw new Error('Invalid snapshot ordering value');
      this.sequence = Math.max(this.sequence, sequence);
      const refs = new Set();
      for (const entry of snapshot.entries) {
        if (!/^[a-f0-9]{64}$/.test(entry.hash) || !objects.has(entry.hash)) throw new Error('Missing or invalid object during retention');
        refs.add(entry.hash);
      }
      points.push({ ...file, refs });
    }
    points.sort((a, b) => Number(a.name.split('-')[0]) - Number(b.name.split('-')[0]) || a.name.localeCompare(b.name));
    const retained = new Set(points);
    const refCounts = new Map();
    for (const point of points) for (const ref of point.refs) refCounts.set(ref, (refCounts.get(ref) ?? 0) + 1);
    let retainedBytes = points.reduce((sum, point) => sum + point.bytes, 0) + [...refCounts.keys()].reduce((sum, ref) => sum + objects.get(ref).bytes, 0);
    // Leave headroom for the next capture without deleting baseline or newest.
    for (const candidate of points.slice(1, -1)) {
      if (retained.size <= this.policy.maxSnapshots && retainedBytes <= this.policy.maxBytes * 0.8) break;
      retained.delete(candidate);
      retainedBytes -= candidate.bytes;
      for (const ref of candidate.refs) {
        refCounts.set(ref, refCounts.get(ref) - 1);
        if (!refCounts.get(ref)) retainedBytes -= objects.get(ref).bytes;
      }
    }
    const live = new Set([...refCounts.keys()].filter(ref => refCounts.get(ref) > 0));
    const removedPoints = points.filter(point => !retained.has(point));
    const removedObjects = [...objects.values()].filter(object => !live.has(object.name));
    // Before pruning, verify bytes behind retained references as well as names.
    // Avoid rehashing history on routine maintenance that has nothing to delete.
    if (removedPoints.length || removedObjects.length) for (const ref of live) {
      const digest = createHash('sha256').update(await fs.readFile(objects.get(ref).path)).digest('hex');
      if (digest !== ref) throw new Error('Corrupt retained object; retention stopped');
    }
    for (const point of removedPoints) await fs.unlink(point.path);
    await syncDirectory(snapshotsDir);
    await this.checkpoint?.('retention-manifests-synced', snapshotsDir);
    for (const object of removedObjects) await fs.unlink(object.path);
    for (const file of files.filter(file => file.temporary)) await fs.unlink(file.path);
    await syncDirectory(objectsDir);
    await syncDirectory(snapshotsDir);
    await this.checkpoint?.('retention-objects-synced', objectsDir);
    this.bytes = retainedBytes;
    this.count = retained.size;
    this.force = false;
    this.lastMaintenance = Date.now();
    this.result = { at: new Date().toISOString(), payloadBytes: this.bytes, snapshots: this.count,
      removedSnapshots: removedPoints.length, removedObjects: removedObjects.length,
      protectedSnapshots: [points[0]?.name, points.at(-1)?.name].filter(Boolean).map(name => name.slice(0, -5)),
      ...this.policy };
    if (this.bytes > this.policy.maxBytes) { this.force = true; throw new StorageFull(); }
  }

  status() { return { ...this.result, snapshots: this.count, reservedPayloadBytes: this.bytes, ...this.policy }; }
}
