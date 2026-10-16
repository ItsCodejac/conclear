// Verifies the packed CLI and real macOS login service in an isolated fixture.
// The temporary service is always uninstalled; the report keeps its evidence.
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
const artifact = resolve(process.argv[2] || '/tmp/conclear-0.5.0.tgz');
const fixture = await fs.mkdtemp(join(tmpdir(), 'conclear-installed-'));
await exec('tar', ['-xzf', artifact, '-C', fixture]);
const cli = join(fixture, 'package', 'dist', 'cli.js');
const user = join(fixture, 'user');
const root = join(user, 'recovery');
const project = join(fixture, 'project');
await fs.mkdir(project);
await fs.writeFile(join(project, 'code.mjs'), 'export const answer = 1;\n');
await fs.writeFile(join(project, '.env'), 'SECRET=not-for-capture');
const env = { ...process.env, CONCLEAR_HOME: user, CONCLEAR_NO_UPDATE_CHECK: '1' };
const command = async (...args) => JSON.parse((await exec(process.execPath, [cli, 'recovery', ...args, '--json'], { env, timeout: 25000 })).stdout);
const { health } = await import(pathToFileURL(join(fixture, 'package/dist/recovery/projects.mjs')));
const { manageService, serviceSpec } = await import(pathToFileURL(join(fixture, 'package/dist/recovery/service.mjs')));
const { readSnapshot } = await import(pathToFileURL(join(fixture, 'package/dist/recovery/persistence.mjs')));
const checks = [];
const until = async predicate => {
  const deadline = Date.now() + 20000;
  for (;;) { const value = await predicate(); if (value) return value; if (Date.now() > deadline) throw new Error('Timed out waiting for observer'); await new Promise(r => setTimeout(r, 100)); }
};
let id;
try {
  const added = await command('add', project);
  id = added.project.id;
  checks.push('Packed CLI enrolls a project and installs its real login service');
  let state = await until(async () => { const h = await health(root); return h.running && h.projects[0]?.capture?.lastSnapshot ? h : null; });
  assert.equal(state.projects[0].capture.watcher, 'active');
  checks.push('Capture continues after enrollment CLI exits; watcher and heartbeat are active');
  await fs.writeFile(join(project, 'code.mjs'), 'export const answer = 42;\n');
  await fs.writeFile(join(project, 'config.json'), '{"working":true}\n');
  const store = join(root, 'stores', id);
  const good = await until(async () => {
    const page = await command('snapshots', id);
    for (const p of page.snapshots) {
      const s = await readSnapshot(join(store, 'snapshots', p.id + '.json'));
      const entry = s.entries.find(e => e.path === 'code.mjs');
      if (s.entries.some(e => e.path === 'config.json') && entry && (await fs.readFile(join(store, 'objects', entry.hash), 'utf8')).includes('42')) return s;
    }
  });
  assert(!good.entries.some(e => e.path === '.env'));
  await command('pin', id, good.id, '--reason', 'Verified installed-package fixture');
  await fs.writeFile(join(project, 'code.mjs'), 'broken\n');
  await fs.unlink(join(project, 'config.json'));
  const restored = join(fixture, 'restored');
  const result = await command('restore', id, good.id, restored);
  assert.equal(result.files, 2);
  assert.equal(await fs.readFile(join(restored, 'code.mjs'), 'utf8'), 'export const answer = 42;\n');
  assert.equal(await fs.readFile(join(restored, 'config.json'), 'utf8'), '{"working":true}\n');
  assert.equal(await fs.readFile(join(project, 'code.mjs'), 'utf8'), 'broken\n');
  checks.push('Actual observed uncommitted files survive overwrite/deletion and restore with verified bytes; original stays untouched');
  checks.push('Default .env exclusion and durable pin are exercised');
  state = await health(root);
  const oldPid = state.daemon.pid;
  process.kill(oldPid, 'SIGKILL');
  state = await until(async () => { const h = await health(root); return h.running && h.daemon.pid !== oldPid && h.projects[0]?.capture?.interruption ? h : null; });
  checks.push('launchd restarts a SIGKILLed observer and the store is reacquired without manual lock cleanup');
  await command('pause', id);
  await until(async () => (await health(root)).projects[0].state === 'paused');
  await command('resume', id);
  await until(async () => (await health(root)).projects[0].capture?.state !== 'stopped');
  await manageService('stop', root);
  await until(async () => !(await health(root)).running);
  checks.push('Pause, resume, and service stop preserve captured history and report status');
  assert.equal((await command('snapshots', id)).snapshots.find(p => p.id === good.id).pin.reason, 'Verified installed-package fixture');
  const report = { ok: true, at: new Date().toISOString(), artifact, fixture, projectId: id, service: serviceSpec(root).label, checks };
  if (process.argv[3]) await fs.writeFile(process.argv[3], JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} finally {
  await manageService('uninstall', root);
}
