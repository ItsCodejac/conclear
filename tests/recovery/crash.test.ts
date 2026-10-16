import { it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import { fork } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { Recorder, restore } from '../../tools/recovery/recorder.mjs';

const cases = [false, true].flatMap(targeted => ['objects', 'snapshots'].flatMap(kind => ['opened', 'written', 'synced', 'renamed', 'durable'].map(phase => ({ kind, phase, targeted }))));

it.each(cases)('restores published history after SIGKILL at $kind/$phase (targeted=$targeted)', async ({ kind, phase, targeted }) => {
  const root = await fs.mkdtemp(join(tmpdir(), 'conclear-storage-crash-'));
  const project = join(root, 'project');
  const store = join(root, 'store');
  await fs.mkdir(project);
  await fs.writeFile(join(project, 'code.ts'), 'known original\n');
  const child = fork(resolve('tests/recovery/crash-worker.mjs'), [project, store], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let restarted;
  try {
    const [ready] = await once(child, 'message');
    expect(ready.event).toBe('ready');
    await fs.writeFile(join(project, 'code.ts'), 'uncommitted replacement\n');
    const paused = once(child, 'message');
    child.send({ kind, phase, targeted });
    expect((await paused)[0].event).toBe('paused');
    const ended = once(child, 'exit');
    child.kill('SIGKILL');
    await ended;

    const published = (await fs.readdir(join(store, 'snapshots'))).filter(name => name.endsWith('.json'));
    expect(published).toHaveLength(kind === 'snapshots' && ['renamed', 'durable'].includes(phase) ? 2 : 1);
    // Validate every published point before restart can repair or supplement anything.
    for (const name of published) {
      const id = name.slice(0, -5);
      const destination = join(root, `before-restart-${id}`);
      await restore(store, id, destination);
      expect(await fs.readFile(join(destination, 'code.ts'), 'utf8')).toBe(id === ready.snapshot ? 'known original\n' : 'uncommitted replacement\n');
    }
    restarted = await new Recorder(project, store, { notifications: false, intervalMs: 60000 }).start();
    expect(restarted.status.interruption).not.toBeNull();
    await restore(store, restarted.status.lastSnapshot, join(root, 'current'));
    expect(await fs.readFile(join(root, 'current', 'code.ts'), 'utf8')).toBe('uncommitted replacement\n');
    await restore(store, ready.snapshot, join(root, 'original'));
    expect(await fs.readFile(join(root, 'original', 'code.ts'), 'utf8')).toBe('known original\n');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended;
    }
    await restarted?.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15000);

it.each(['retention-manifests-synced', 'retention-objects-synced'])('retained snapshots survive SIGKILL at %s', async phase => {
  const root = await fs.mkdtemp(join(tmpdir(), 'conclear-prune-crash-'));
  const project = join(root, 'project'), store = join(root, 'store');
  await fs.mkdir(project);
  await fs.writeFile(join(project, 'code.ts'), 'version-0');
  const seed = new Recorder(project, store, { notifications: false, intervalMs: 60000, maxSnapshots: 10, retentionMode: 'expire' });
  let child, restarted;
  try {
    await seed.start();
    const baseline = seed.status.lastSnapshot;
    for (let i = 1; i <= 3; i++) {
      await fs.writeFile(join(project, 'code.ts'), `version-${i}`);
      await seed.capture();
    }
    await seed.stop();
    child = fork(resolve('tests/recovery/crash-worker.mjs'), [project, store], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    expect((await once(child, 'message'))[0].event).toBe('ready');
    const paused = once(child, 'message');
    child.send({ kind: 'retention', phase });
    expect((await paused)[0].event).toBe('paused');
    const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended;
    const names = (await fs.readdir(join(store, 'snapshots'))).filter(name => name.endsWith('.json'));
    expect(names).toHaveLength(2);
    expect(names).toContain(`${baseline}.json`);
    for (const name of names) {
      const id = name.slice(0, -5), destination = join(root, id);
      await restore(store, id, destination);
      expect(await fs.readFile(join(destination, 'code.ts'), 'utf8')).toBe(id === baseline ? 'version-0' : 'version-3');
    }
    restarted = await new Recorder(project, store, { notifications: false, intervalMs: 60000, maxSnapshots: 2 }).start();
    await restore(store, baseline, join(root, 'baseline-after-restart'));
    expect(await fs.readFile(join(root, 'baseline-after-restart', 'code.ts'), 'utf8')).toBe('version-0');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill('SIGKILL'); await ended; }
    await seed.stop();
    await restarted?.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15000);
