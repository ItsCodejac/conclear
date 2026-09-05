import { it, expect, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Recorder, restore } from '../../tools/recovery/recorder.mjs';

async function fixture(run) {
  const root = await fs.mkdtemp(join(tmpdir(), 'conclear-retention-'));
  const project = join(root, 'project'), store = join(root, 'store');
  await fs.mkdir(project);
  const recorder = new Recorder(project, store, { notifications: false, intervalMs: 60000, maxSnapshots: 3 });
  try { await run({ root, project, store, recorder }); }
  finally { await recorder.stop(); await fs.rm(root, { recursive: true, force: true }); }
}
const ids = async store => (await fs.readdir(join(store, 'snapshots'))).filter(name => name.endsWith('.json')).sort().map(name => name.slice(0, -5));
async function payload(store) {
  let total = 0;
  for (const dir of ['objects', 'snapshots']) for (const name of await fs.readdir(join(store, dir))) total += (await fs.stat(join(store, dir, name))).size;
  return total;
}

it('keeps baseline and latest, prunes older points, and preserves shared objects across restart', async () => fixture(async ({ root, project, store, recorder }) => {
  await fs.writeFile(join(project, 'common'), 'shared');
  await fs.writeFile(join(project, 'code'), 'version-0');
  await recorder.start();
  const baseline = recorder.status.lastSnapshot;
  const expected = new Map([[baseline, 'version-0']]);
  for (let i = 1; i <= 6; i++) {
    await fs.writeFile(join(project, 'code'), `version-${i}`);
    const snapshot = await recorder.capture(); expected.set(snapshot.id, `version-${i}`);
  }
  const retained = await ids(store);
  expect(retained).toHaveLength(3);
  expect(retained).toContain(baseline);
  expect(retained).toContain(recorder.status.lastSnapshot);
  expect(await fs.readdir(join(store, 'objects'))).toHaveLength(4);
  for (const id of retained) {
    const destination = join(root, id);
    await restore(store, id, destination);
    expect(await fs.readFile(join(destination, 'code'), 'utf8')).toBe(expected.get(id));
    expect(await fs.readFile(join(destination, 'common'), 'utf8')).toBe('shared');
  }
  await recorder.stop();
  const restarted = await new Recorder(project, store, { notifications: false, intervalMs: 60000 }).start();
  try {
    expect(restarted.storage.policy.maxSnapshots).toBe(3);
    expect(await ids(store)).toContain(baseline);
    expect(await ids(store)).toHaveLength(3);
  } finally { await restarted.stop(); }
}));

it('stops writes at the byte budget without deleting the only recovery point', async () => fixture(async ({ root, project, store, recorder }) => {
  recorder.requestedPolicy.maxBytes = 1800;
  await fs.writeFile(join(project, 'code'), 'a'.repeat(700));
  await recorder.start();
  const baseline = recorder.status.lastSnapshot;
  await fs.writeFile(join(project, 'code'), 'b'.repeat(700));
  await expect(recorder.capture()).rejects.toThrow('budget exhausted');
  expect(recorder.status.state).toBe('storage-full');
  expect(await payload(store)).toBeLessThanOrEqual(1800);
  await restore(store, baseline, join(root, 'safe'));
  expect(await fs.readFile(join(root, 'safe', 'code'), 'utf8')).toBe('a'.repeat(700));
  await fs.writeFile(join(project, 'code'), 'a'.repeat(700));
  await recorder.capture();
  expect(recorder.status.state).toBe('observing');
  expect(await ids(store)).toEqual([baseline]);
}));

it('requires explicit policy migration for an old unbounded store', async () => fixture(async ({ project, store, recorder }) => {
  await fs.mkdir(store);
  await fs.writeFile(join(store, 'project.json'), JSON.stringify({ version: 1, project: await fs.realpath(project) }));
  const unconfigured = new Recorder(project, store, { notifications: false });
  await expect(unconfigured.start()).rejects.toThrow('explicit');
  await recorder.start();
  expect(JSON.parse(await fs.readFile(join(store, 'project.json'), 'utf8')).retention.maxSnapshots).toBe(3);
}));

it('refuses pruning when a published manifest cannot be decoded', async () => fixture(async ({ project, store, recorder }) => {
  await fs.writeFile(join(project, 'code'), 'original');
  await recorder.start();
  const baseline = recorder.status.lastSnapshot;
  const path = join(store, 'snapshots', `${baseline}.json`);
  await fs.writeFile(path, '{invalid');
  recorder.storage.force = true;
  const before = await fs.readdir(join(store, 'objects'));
  await expect(recorder.capture()).rejects.toThrow();
  expect(await fs.readdir(join(store, 'objects'))).toEqual(before);
  expect(await ids(store)).toEqual([baseline]);
}));

it('preserves snapshot ordering when the wall clock moves backward', async () => fixture(async ({ project, store, recorder }) => {
  await fs.writeFile(join(project, 'code'), 'baseline');
  await recorder.start();
  const baseline = recorder.status.lastSnapshot;
  const sequence = Number(baseline.split('-')[0]);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(sequence - 100000);
  try {
    for (let i = 0; i < 4; i++) {
      await fs.writeFile(join(project, 'code'), `new-${i}`);
      const point = await recorder.capture();
      expect(Number(point.id.split('-')[0])).toBeGreaterThan(sequence);
    }
    expect(await ids(store)).toContain(baseline);
    expect((await ids(store)).at(-1)).toBe(recorder.status.lastSnapshot);
  } finally { clock.mockRestore(); }
}));

it('fails a lowered budget without deleting protected history', async () => fixture(async ({ root, project, store, recorder }) => {
  await fs.writeFile(join(project, 'code'), 'a'.repeat(700));
  await recorder.start();
  const baseline = recorder.status.lastSnapshot;
  await fs.writeFile(join(project, 'code'), 'b'.repeat(700));
  const last = await recorder.capture();
  await recorder.stop();
  const smaller = new Recorder(project, store, { notifications: false, maxBytes: 1800 });
  await expect(smaller.start()).rejects.toThrow('budget exhausted');
  expect(await ids(store)).toEqual([baseline, last.id]);
  await restore(store, baseline, join(root, 'baseline'));
  await restore(store, last.id, join(root, 'newest'));
  expect(await fs.readFile(join(root, 'newest', 'code'), 'utf8')).toBe('b'.repeat(700));
}));
