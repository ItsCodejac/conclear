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
