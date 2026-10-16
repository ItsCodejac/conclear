import { it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fork, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { Recorder, restore } from '../../tools/recovery/recorder.mjs';
import { setPin, listSnapshots, readPins } from '../../tools/recovery/control.mjs';

const exec = promisify(execFile);
async function fixture(run, options = {}) {
  const root = await fs.mkdtemp(join(tmpdir(), 'conclear-protection-'));
  const project = join(root, 'project'), store = join(root, 'store');
  await fs.mkdir(project);
  await fs.writeFile(join(project, 'code.ts'), 'baseline');
  const recorder = await new Recorder(project, store, { notifications: false, intervalMs: 60000, ...options }).start();
  try { await run({ root, project, store, recorder }); }
  finally { await recorder.stop(); await fs.rm(root, { recursive: true, force: true }); }
}

it('preserves all history by default, pauses at the point limit, and restarts without a duplicate baseline', async () => fixture(async ({ project, store, recorder }) => {
  await fs.writeFile(join(project, 'code.ts'), 'working');
  await recorder.capture();
  const before = (await listSnapshots(store)).map(point => point.id);
  await fs.writeFile(join(project, 'code.ts'), 'broken');
  await expect(recorder.capture()).rejects.toThrow('point limit');
  expect(recorder.status.state).toBe('storage-full');
  expect(recorder.status.lastError.resource).toBe('snapshots');
  expect((await listSnapshots(store)).map(point => point.id)).toEqual(before);
  await fs.writeFile(join(project, 'code.ts'), 'working');
  await recorder.stop();
  const restarted = await new Recorder(project, store, { notifications: false, intervalMs: 60000 }).start();
  try {
    expect(restarted.storage.policy.mode).toBe('preserve');
    expect((await listSnapshots(store)).map(point => point.id)).toEqual(before);
  } finally { await restarted.stop(); }
}, { maxSnapshots: 2 }));

it('pins through expiry and restart, records provenance, and releases protection only on explicit unpin', async () => fixture(async ({ root, project, store, recorder }) => {
  const baseline = recorder.status.lastSnapshot;
  await fs.writeFile(join(project, 'code.ts'), 'working');
  const working = await recorder.capture();
  await setPin(store, working.id, { actor: 'agent', reason: 'Fixture tests passed', sourceRef: 'fixture:message-42' });
  for (let i = 0; i < 5; i++) {
    await fs.writeFile(join(project, 'code.ts'), `rewrite-${i}`);
    await recorder.capture();
  }
  const points = await listSnapshots(store);
  expect(points).toHaveLength(3);
  expect(points.map(point => point.id)).toContain(baseline);
  expect(points.find(point => point.id === working.id).pin.sourceRef).toBe('fixture:message-42');
  await recorder.stop();
  const restarted = await new Recorder(project, store, { notifications: false, intervalMs: 60000 }).start();
  try {
    await restore(store, working.id, join(root, 'working'));
    expect(await fs.readFile(join(root, 'working', 'code.ts'), 'utf8')).toBe('working');
    await setPin(store, working.id, { actor: 'user', reason: 'Review complete' }, true);
    await fs.writeFile(join(project, 'code.ts'), 'after-unpin');
    await restarted.capture();
    expect((await listSnapshots(store)).map(point => point.id)).not.toContain(working.id);
    expect((await readPins(store)).events.at(-1).action).toBe('unpin');
  } finally { await restarted.stop(); }
}, { maxSnapshots: 3, retentionMode: 'expire' }));

it('never discards pins to satisfy a smaller limit', async () => fixture(async ({ project, store, recorder }) => {
  await fs.writeFile(join(project, 'code.ts'), 'working');
  const working = await recorder.capture();
  await setPin(store, working.id, { reason: 'Keep this' });
  await fs.writeFile(join(project, 'code.ts'), 'newest');
  await recorder.capture();
  const before = (await listSnapshots(store)).map(point => point.id);
  recorder.storage.policy.maxSnapshots = 2;
  recorder.storage.force = true;
  await expect(recorder.capture()).rejects.toThrow('point limit');
  expect((await listSnapshots(store)).map(point => point.id)).toEqual(before);
}, { retentionMode: 'expire' }));

it('fails cleanup closed on corrupted pin metadata', async () => fixture(async ({ store, recorder }) => {
  await fs.writeFile(join(store, 'pins.json'), '{invalid');
  recorder.storage.force = true;
  const before = await fs.readdir(join(store, 'objects'));
  await expect(recorder.capture()).rejects.toThrow();
  expect(await fs.readdir(join(store, 'objects'))).toEqual(before);
}));

it('coordinates a real child-process restore with expiration', async () => fixture(async ({ root, project, store, recorder }) => {
  await fs.writeFile(join(project, 'code.ts'), 'working');
  const selected = await recorder.capture();
  await fs.writeFile(join(project, 'code.ts'), 'latest');
  await recorder.capture();
  const destination = join(root, 'restored');
  const child = fork(resolve('tests/recovery/restore-worker.mjs'), [store, selected.id, destination], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  try {
    expect((await once(child, 'message'))[0].event).toBe('verified');
    recorder.storage.policy.maxSnapshots = 2;
    recorder.storage.force = true;
    let finished = false;
    const cleanup = recorder.capture().then(() => { finished = true; });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(finished).toBe(false);
    expect(await fs.stat(join(store, 'snapshots', `${selected.id}.json`))).toBeDefined();
    const result = once(child, 'message');
    child.send('release');
    expect((await result)[0].event).toBe('restored');
    await cleanup;
    expect(await fs.readFile(join(destination, 'code.ts'), 'utf8')).toBe('working');
    expect((await listSnapshots(store)).map(point => point.id)).not.toContain(selected.id);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended; }
  }
}, { retentionMode: 'expire' }));

it('supports CLI listing and explicit pin/unpin with a reason', async () => fixture(async ({ store, recorder }) => {
  const cli = resolve('tools/recovery/cli.mjs');
  const id = recorder.status.lastSnapshot;
  const pin = await exec(process.execPath, [cli, 'pin', store, id, '--reason', 'Reviewed locally', '--by', 'user']);
  expect(JSON.parse(pin.stdout).action).toBe('pinned');
  const listed = await exec(process.execPath, [cli, 'list', store]);
  expect(JSON.parse(listed.stdout)[0].pin.reason).toBe('Reviewed locally');
  await expect(exec(process.execPath, [cli, 'unpin', store, id])).rejects.toThrow();
  await exec(process.execPath, [cli, 'unpin', store, id, '--reason', 'No longer needed']);
  expect((await readPins(store)).pins).toHaveLength(0);
}));
