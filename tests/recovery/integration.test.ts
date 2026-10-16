import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { request } from 'node:http';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { enroll, health, updateProject, snapshots } from '../../src/recovery/projects.mjs';
import { serviceSpec, manageService } from '../../src/recovery/service.mjs';
import { recoveryRoutes } from '../../src/server/routes/recovery.js';
import { Recovery } from '../../src/client/pages/Recovery.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const base = await fs.mkdtemp(join(tmpdir(), 'conclear-integration-')); roots.push(base);
  const project = join(base, 'project'); await fs.mkdir(project);
  const root = join(base, 'user', 'recovery');
  return { base, project, root };
}
describe('shipped recovery integration', () => {
  it('enrolls explicitly, preserves safe defaults, and reports offline instead of capture success', async () => {
    const { project, root } = await fixture();
    const p = await enroll(project, {}, root);
    expect(p.policy).toEqual({ maxBytes: 536870912, maxSnapshots: 200, mode: 'preserve' });
    expect(p.exclusions).toEqual(['.env', '.env.local']);
    expect((await health(root)).projects[0].state).toBe('offline');
    expect((await snapshots(p.id, {}, root)).snapshots).toEqual([]);
    await expect(enroll(project, {}, root)).rejects.toThrow('already enrolled');
    await updateProject(p.id, { enabled: false }, root);
    expect((await health(root)).projects[0].state).toBe('paused');
    await updateProject(p.id, { policy: { maxBytes: 1024000 } }, root);
    expect((await health(root)).projects[0].policy.mode).toBe('preserve');
  });
  it('rejects overlapping storage, invalid policies and unsafe exclusions', async () => {
    const { project, root } = await fixture();
    await expect(enroll(project, { exclusions: ['../outside'] }, root)).rejects.toThrow('Exclusions');
    await expect(enroll(project, { policy: { mode: 'invented' } }, root)).rejects.toThrow('Retention');
    await expect(enroll(project, {}, join(project, 'store'))).rejects.toThrow('separate');
    const p = await enroll(project, {}, root);
    await expect(snapshots(p.id, { limit: 201 }, root)).rejects.toThrow('limit');
  });
  it('does not mistake a stale heartbeat for active recording', async () => {
    const { project, root } = await fixture();
    await enroll(project, {}, root);
    await fs.writeFile(join(root, 'daemon.json'), JSON.stringify({ pid: process.pid, state: 'running', heartbeatAt: '2000-01-01T00:00:00Z' }));
    expect((await health(root)).running).toBe(false);
    expect((await health(root)).projects[0].state).toBe('offline');
  });
  it('renders the user-facing enrollment, health, and no-promise contract', () => {
    const html = renderToStaticMarkup(createElement(Recovery, { toast() {} }));
    expect(html).toContain('Background observer');
    expect(html).toContain('Enroll and start background capture');
    expect(html).toContain('Notifications can miss rapid intermediate writes');
  });
  it('renders launchd and systemd service arguments without a shell', async () => {
    const { root, base } = await fixture();
    expect(serviceSpec(root + ' a&b', 'darwin', base).content).toContain('a&amp;b');
    expect(serviceSpec(root + ' a%"b', 'linux', base).content).toContain('%%\\"b');
    expect(serviceSpec(root, 'win32', base).supported).toBe(false);
    const calls: unknown[][] = [];
    const execute = async (...args: unknown[]) => { calls.push(args); return {}; };
    await manageService('install', root, { execute, home: base, platform: 'linux' });
    expect(calls.map(c => c.slice(0, 2))).toEqual([
      ['systemctl', ['--user', 'daemon-reload']],
      ['systemctl', ['--user', 'enable', '--now', serviceSpec(root, 'linux', base).label]],
    ]);
    await manageService('uninstall', root, { execute, home: base, platform: 'linux' });
    await expect(fs.access(serviceSpec(root, 'linux', base).path!)).rejects.toThrow();
  });
  it('serves recovery status and rejects cross-origin and rebound-host requests', async () => {
    const app = express(); app.use(express.json()); app.use('/api/recovery', recoveryRoutes);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}/api/recovery`;
    try {
      expect((await fetch(url + '/status')).status).toBe(200);
      expect((await fetch(url + '/status', { headers: { origin: 'https://untrusted.example' } })).status).toBe(403);
      const rebound = await new Promise<number | undefined>((resolve, reject) => {
        request(url + '/status', { headers: { host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject).end();
      });
      expect(rebound).toBe(403);
      expect((await fetch(url + '/service/install', { method: 'POST', headers: { origin: 'https://untrusted.example' } })).status).toBe(403);
    } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
  });
});
