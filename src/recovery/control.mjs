import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { atomic, readSnapshot } from './persistence.mjs';
import { acquireLease } from './locks.mjs';

export const validId = id => typeof id === 'string' && /^\d+-[a-f0-9-]+$/.test(id);
// Shared by recording maintenance, pin changes, listing and complete restores.
export async function withStoreLock(store, work, options) {
  const release = await acquireLease(join(store, 'control.sqlite'), options);
  try { return await work(); } finally { release(); }
}

export async function readPins(store) {
  let record;
  try { record = JSON.parse(await fs.readFile(join(store, 'pins.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { version: 1, pins: [], events: [] }; throw error; }
  if (record.version !== 1 || !Array.isArray(record.pins) || record.pins.length > 1000 || !Array.isArray(record.events) || record.events.length > 100) throw new Error('Invalid pin metadata; cleanup stopped');
  const seen = new Set();
  for (const pin of record.pins) {
    if (!validId(pin.snapshotId) || seen.has(pin.snapshotId) || typeof pin.reason !== 'string' || pin.reason.length > 1000 || !['user', 'agent'].includes(pin.actor)) throw new Error('Invalid pin metadata; cleanup stopped');
    seen.add(pin.snapshotId);
  }
  return record;
}

export async function setPin(store, id, { reason, actor = 'user', sourceRef } = {}, remove = false) {
  if (!validId(id)) throw new Error('Invalid snapshot id');
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 1000 || !['user', 'agent'].includes(actor) || (sourceRef !== undefined && (typeof sourceRef !== 'string' || sourceRef.length > 512))) throw new Error('Supply a reason (1–1000 characters), actor user/agent, and optional source reference (up to 512 characters)');
  store = await fs.realpath(store);
  return withStoreLock(store, async () => {
    const record = await readPins(store);
    const previous = record.pins.find(pin => pin.snapshotId === id);
    if (remove && !previous) throw new Error('Snapshot is not pinned');
    if (!remove) {
      const snapshot = await readSnapshot(join(store, 'snapshots', `${id}.json`));
      if (snapshot.id !== id || snapshot.version !== 1 || !Array.isArray(snapshot.entries)) throw new Error('Invalid snapshot');
      for (const entry of snapshot.entries) {
        if (!/^[a-f0-9]{64}$/.test(entry.hash)) throw new Error('Invalid recovery object');
        const data = await fs.readFile(join(store, 'objects', entry.hash));
        if (createHash('sha256').update(data).digest('hex') !== entry.hash) throw new Error('Corrupt recovery object');
      }
      if (!previous && record.pins.length >= 1000) throw new Error('Pin metadata limit reached');
    }
    const at = new Date().toISOString();
    const entry = { snapshotId: id, reason: reason.trim(), actor, ...(sourceRef === undefined ? {} : { sourceRef }), createdAt: previous?.createdAt ?? at, updatedAt: at };
    record.pins = record.pins.filter(pin => pin.snapshotId !== id);
    if (!remove) record.pins.push(entry);
    record.events = [...record.events, { action: remove ? 'unpin' : 'pin', snapshotId: id, reason: entry.reason, actor, at }].slice(-100);
    await atomic(join(store, 'pins.json'), JSON.stringify(record));
    return { action: remove ? 'unpinned' : 'pinned', ...entry };
  });
}

export async function listSnapshots(store) {
  store = await fs.realpath(store);
  return withStoreLock(store, async () => {
    const pins = (await readPins(store)).pins;
    const names = (await fs.readdir(join(store, 'snapshots'))).filter(name => /^\d+-[a-f0-9-]+\.json$/.test(name)).sort();
    const snapshots = [];
    for (const name of names) {
      const point = await readSnapshot(join(store, 'snapshots', name));
      snapshots.push({ id: point.id, startedAt: point.startedAt, finishedAt: point.finishedAt, scope: point.scope ?? 'full-tree', reason: point.reason, files: point.entries.length, skipped: point.skipped.length, pin: pins.find(pin => pin.snapshotId === point.id) ?? null });
    }
    return snapshots;
  });
}
