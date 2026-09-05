import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { Recorder, restore } from '../../tools/recovery/recorder.mjs';

const exec = promisify(execFile);
const roots: string[] = [];
const recorders: Recorder[] = [];
const children: ReturnType<typeof spawn>[] = [];
async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'conclear-recorder-'));
  roots.push(root);
  const project = join(root, 'project');
  const store = join(root, 'store');
  await fs.mkdir(project);
  return { root, project, store };
}
async function start(project: string, store: string, options = {}) {
  const recorder = new Recorder(project, store, { notifications: false, intervalMs: 60_000, ...options });
  recorders.push(recorder);
  await recorder.start();
  return recorder;
}
async function snapshots(store: string) {
  const names = (await fs.readdir(join(store, 'snapshots'))).filter(name => name.endsWith('.json')).sort();
  return Promise.all(names.map(async name => JSON.parse(await fs.readFile(join(store, 'snapshots', name), 'utf8'))));
}
async function eventually(check: () => Promise<boolean>) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Condition not reached in 5 seconds');
}
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended;
    }
  }
  for (const recorder of recorders.splice(0)) await recorder.stop();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe('experimental recovery recorder', () => {
  it('restores exact uncommitted bytes across shell writes, rename and deletion', async () => {
    const { root, project, store } = await fixture();
    await fs.writeFile(join(project, 'code.ts'), 'original\n');
    const binary = Buffer.from([0, 255, 128, 10]);
    await fs.writeFile(join(project, 'data.bin'), binary);
    const recorder = await start(project, store);
    const original = recorder.status.lastSnapshot;
    await exec('/bin/sh', ['-c', "printf 'shell edit\\n' > code.ts"], { cwd: project });
    const edited = await recorder.capture('shell-edit');
    await fs.rename(join(project, 'code.ts'), join(project, 'renamed.ts'));
    await fs.unlink(join(project, 'data.bin'));
    const renamed = await recorder.capture('rename-delete');
    await restore(store, original, join(root, 'original'));
    await restore(store, edited.id, join(root, 'edited'));
    await restore(store, renamed.id, join(root, 'renamed'));
    expect(await fs.readFile(join(root, 'original', 'code.ts'), 'utf8')).toBe('original\n');
    expect(await fs.readFile(join(root, 'original', 'data.bin'))).toEqual(binary);
    expect(await fs.readFile(join(root, 'edited', 'code.ts'), 'utf8')).toBe('shell edit\n');
    expect(await fs.readdir(join(root, 'renamed'))).toEqual(['renamed.ts']);
    expect(await fs.readFile(join(project, 'renamed.ts'), 'utf8')).toBe('shell edit\n');
  });

  it('captures actual filesystem notifications without waiting for reconciliation', async () => {
    const { project, store } = await fixture();
    const recorder = await start(project, store, { notifications: true });
    expect(recorder.status.watcher).toBe('active');
    await fs.mkdir(join(project, 'nested'));
    await fs.writeFile(join(project, 'nested', 'new.ts'), 'watched');
    await eventually(async () => (await snapshots(store)).some(s => s.entries.some(e => e.path === 'nested/new.ts')));
    expect((await snapshots(store)).some(s => s.reason === 'notification')).toBe(true);
  });

  it('reconciles current contents when notifications are entirely disabled', async () => {
    const { project, store } = await fixture();
    await start(project, store, { intervalMs: 30 });
    await fs.writeFile(join(project, 'missed-event.ts'), 'event not needed');
    await eventually(async () => (await snapshots(store)).some(s => s.reason === 'reconciliation' && s.entries.length === 1));
  });

  it('demonstrates that rapid intermediate writes between observations are unrecoverable', async () => {
    const { root, project, store } = await fixture();
    await fs.writeFile(join(project, 'code.ts'), 'baseline');
    const recorder = await start(project, store);
    await exec(process.execPath, ['-e', "const fs=require('fs');for(let i=0;i<100;i++)fs.writeFileSync('code.ts','version-'+i)"], { cwd: project });
    const final = await recorder.capture('after-burst');
    expect(await snapshots(store)).toHaveLength(2);
    expect(await fs.readdir(join(store, 'objects'))).toHaveLength(2);
    await restore(store, final.id, join(root, 'burst'));
    expect(await fs.readFile(join(root, 'burst', 'code.ts'), 'utf8')).toBe('version-99');
  });

  it('preserves published snapshots across SIGKILL and reports the restart gap', async () => {
    const { root, project, store } = await fixture();
    await fs.writeFile(join(project, 'code.ts'), 'before crash');
    const child = spawn(process.execPath, [resolve('tools/recovery/cli.mjs'), 'watch', project, store], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let output = '';
    child.stdout!.on('data', chunk => { output += chunk; });
    await eventually(async () => output.includes('"event":"ready"'));
    const baseline = (await snapshots(store))[0];
    const ended = once(child, 'exit');
    child.kill('SIGKILL');
    await ended;
    await fs.writeFile(join(project, 'code.ts'), 'lost while offline');
    await fs.writeFile(join(project, 'code.ts'), 'current after crash');
    // A torn, unpublished temporary manifest must not become a recovery point.
    await fs.writeFile(join(store, 'snapshots', 'unfinished.tmp'), '{');
    const recorder = await start(project, store);
    expect(recorder.status.interruption.previousState).toBe('observing');
    expect(await snapshots(store)).toHaveLength(2);
    await restore(store, baseline.id, join(root, 'pre-crash'));
    expect(await fs.readFile(join(root, 'pre-crash', 'code.ts'), 'utf8')).toBe('before crash');
    await restore(store, recorder.status.lastSnapshot, join(root, 'post-crash'));
    expect(await fs.readFile(join(root, 'post-crash', 'code.ts'), 'utf8')).toBe('current after crash');
  });

  it('does not publish a successful scan when the project disappears', async () => {
    const { root, project, store } = await fixture();
    await fs.writeFile(join(project, 'code.ts'), 'keep');
    const recorder = await start(project, store);
    const last = recorder.status.lastSuccessfulScan;
    await fs.rename(project, join(root, 'moved'));
    await expect(recorder.capture()).rejects.toThrow();
    expect(recorder.status.state).toBe('error');
    expect(recorder.status.lastSuccessfulScan).toBe(last);
    expect(await snapshots(store)).toHaveLength(1);
  });

  it('reports excluded files and skips symlinks instead of following them', async () => {
    const { root, project, store } = await fixture();
    await fs.writeFile(join(root, 'outside'), 'outside');
    await fs.symlink(join(root, 'outside'), join(project, 'linked'));
    await fs.mkdir(join(project, 'node_modules'));
    await fs.writeFile(join(project, 'node_modules', 'ignored'), 'dependency');
    const recorder = await start(project, store);
    expect(recorder.status.state).toBe('limited');
    expect(recorder.status.skipped).toHaveLength(2);
    expect((await snapshots(store))[0].entries).toEqual([]);
  });

  it('rejects overwrites, traversal, nested stores, a second writer and corrupt objects', async () => {
    const { root, project, store } = await fixture();
    await fs.writeFile(join(project, 'code.ts'), 'safe');
    const recorder = await start(project, store);
    await expect(new Recorder(project, store).start()).rejects.toThrow('live writer');
    await expect(new Recorder(project, join(project, 'store')).start()).rejects.toThrow('separate trees');
    const snapshot = (await snapshots(store))[0];
    await expect(restore(store, snapshot.id, project)).rejects.toThrow('separate');
    await fs.mkdir(join(root, 'existing'));
    await expect(restore(store, snapshot.id, join(root, 'existing'))).rejects.toThrow();
    const manifest = join(store, 'snapshots', `${snapshot.id}.json`);
    await fs.writeFile(manifest, JSON.stringify({ ...snapshot, entries: [{ ...snapshot.entries[0], path: '../escape' }] }));
    await expect(restore(store, snapshot.id, join(root, 'unsafe'))).rejects.toThrow('Unsafe');
    await fs.writeFile(manifest, JSON.stringify(snapshot));
    await fs.writeFile(join(store, 'objects', snapshot.entries[0].hash), 'corrupt');
    await expect(restore(store, snapshot.id, join(root, 'corrupt'))).rejects.toThrow('Corrupt');
    await expect(recorder.capture()).rejects.toThrow('Corrupt');
  });

  it('measures deduplicated storage and scan cost on a synthetic project', async () => {
    const { project, store } = await fixture();
    for (let i = 0; i < 100; i++) await fs.writeFile(join(project, `file-${i}.ts`), `${i}:` + 'x'.repeat(4096));
    const recorder = await start(project, store);
    const baseline = { ...recorder.status.metrics };
    expect(await recorder.capture('unchanged')).toBeNull();
    expect(recorder.status.metrics.newObjectBytes).toBe(0);
    await fs.writeFile(join(project, 'file-0.ts'), 'changed');
    await recorder.capture('single-change');
    expect(recorder.status.metrics.newObjectBytes).toBe(7);
    expect(await fs.readdir(join(store, 'objects'))).toHaveLength(101);
    let storedBytes = 0;
    for (const dir of ['objects', 'snapshots']) for (const name of await fs.readdir(join(store, dir))) storedBytes += (await fs.stat(join(store, dir, name))).size;
    console.log('RECORDER_MEASUREMENT', JSON.stringify({ baseline, changed: recorder.status.metrics, storedBytes, snapshots: (await snapshots(store)).length }));
  });
});
