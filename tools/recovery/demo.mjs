// Live, disposable demonstration. Every recovery point comes from the recorder.
import * as fs from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Recorder, readSnapshot, restore } from './recorder.mjs';
import { listSnapshots, setPin } from './control.mjs';

const exec = promisify(execFile);
const digest = data => createHash('sha256').update(data).digest('hex');
const workingCode = `export function quote(items, policy) {
  if (!items.length) throw new Error('Cart is empty');
  const subtotalCents = items.reduce((sum, item) => {
    if (!Number.isInteger(item.unitCents) || item.unitCents < 0 || !Number.isInteger(item.quantity) || item.quantity < 1) throw new Error('Invalid item');
    return sum + item.unitCents * item.quantity;
  }, 0);
  const discountCents = Math.round(subtotalCents * policy.discountBps / 10000);
  const taxableCents = subtotalCents - discountCents;
  const taxCents = Math.round(taxableCents * policy.taxBps / 10000);
  return { subtotalCents, discountCents, taxCents, totalCents: taxableCents + taxCents };
}
`;
const starterCode = `export function quote() { throw new Error('Checkout not implemented'); }
`;
const brokenCode = `// A later shell rewrite loses the working implementation.
export function quote() { return { totalCents: 0 }; }
`;
const testCode = `import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { quote } from './quote.mjs';
const policy = JSON.parse(readFileSync(new URL('./pricing.json', import.meta.url)));
test('discount and tax use integer cents', () => {
  assert.deepEqual(quote([{ unitCents: 1299, quantity: 2 }, { unitCents: 499, quantity: 1 }], policy),
    { subtotalCents: 3097, discountCents: 310, taxCents: 209, totalCents: 2996 });
});
test('empty carts are rejected', () => assert.throws(() => quote([], policy), /empty/));
test('invalid quantities are rejected', () => assert.throws(() => quote([{ unitCents: 100, quantity: 0 }], policy), /Invalid/));
`;

export async function createDemo() {
  const root = await fs.mkdtemp(join(tmpdir(), 'conclear-live-demo-'));
  const project = join(root, 'checkout'), store = join(root, 'recovery');
  let recorder;
  const evidence = [];
  let phase = 0, protectedId = null, recovered = null, testResult = null;
  const git = args => exec('git', args, { cwd: project, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
  const record = (action, detail) => evidence.push({ at: new Date().toISOString(), action, ...detail });
  async function tests(directory) {
    try {
      const { stdout } = await exec(process.execPath, ['--test', 'quote.test.mjs'], { cwd: directory, timeout: 10000 });
      return { passed: true, output: stdout };
    } catch (error) { return { passed: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }; }
  }
  async function observed(predicate) {
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline) {
      const points = await listSnapshots(store);
      for (const point of points.reverse()) {
        const snapshot = await readSnapshot(join(store, 'snapshots', `${point.id}.json`));
        if (predicate(snapshot)) return snapshot;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Automatic capture was not observed within 10 seconds; check recorder status');
  }
  try {
    await fs.mkdir(project);
    await fs.writeFile(join(project, 'quote.mjs'), starterCode);
    await fs.writeFile(join(project, 'quote.test.mjs'), testCode);
    await fs.writeFile(join(project, 'pricing.json'), '{"discountBps":1000,"taxBps":750}\n');
    await git(['-c', 'init.templateDir=', 'init', '--quiet']);
    await git(['add', '.']);
    await git(['-c', 'user.name=ConClear Demo', '-c', 'user.email=demo@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'Starter only; checkout not implemented']);
    recorder = await new Recorder(project, store, { intervalMs: 100, maxBytes: 8 * 1024 * 1024, maxSnapshots: 100, retentionMode: 'preserve' }).start();
    if (recorder.status.watcher !== 'active') throw new Error(`Filesystem watching unavailable: ${recorder.status.watcherError}`);
    testResult = await tests(project);
    if (testResult.passed) throw new Error('Starter fixture unexpectedly passed');
    record('baseline', { snapshotId: recorder.status.lastSnapshot, testsPassed: false, gitCommits: 1 });
  } catch (error) { await recorder?.stop(); await fs.rm(root, { recursive: true, force: true }); throw error; }

  async function state() {
    return { phase, project, store, recovered, protectedId, recorder: recorder.status, testResult,
      commits: Number((await git(['rev-list', '--count', 'HEAD'])).stdout.trim()),
      gitStatus: (await git(['status', '--short'])).stdout,
      sourceCode: await fs.readFile(join(project, 'quote.mjs'), 'utf8'),
      recoveredCode: recovered ? await fs.readFile(join(recovered, 'quote.mjs'), 'utf8') : null,
      snapshots: await listSnapshots(store), evidence };
  }
  let busy = false;
  async function action(name) {
    if (busy) throw new Error('Another demo operation is running');
    const expected = ['working', 'pin', 'break', 'restore'][phase];
    if (name !== expected) throw new Error(`Next action is ${expected ?? 'complete'}`);
    busy = true;
    try {
      if (name === 'working') {
        // Fixed fixture content written by an actual shell command; no transcript
        // replay, recorded-command execution, or forced recorder.capture() call.
        await exec('/bin/sh', ['-c', `cat > quote.mjs <<'CONCLEAR_FIXTURE'\n${workingCode}CONCLEAR_FIXTURE\n`], { cwd: project });
        const snapshot = await observed(point => point.entries.some(entry => entry.path === 'quote.mjs' && entry.hash === digest(workingCode)));
        testResult = await tests(project);
        if (!testResult.passed) throw new Error('Working fixture tests failed');
        protectedId = snapshot.id;
        record('working-uncommitted', { snapshotId: snapshot.id, testsPassed: true, captureReason: snapshot.reason });
      } else if (name === 'pin') {
        const result = await setPin(store, protectedId, { actor: 'user', reason: 'Three fixture tests passed; working implementation has no Git commit', sourceRef: 'local-demo:working-uncommitted' });
        record('pin', result);
      } else if (name === 'break') {
        await exec('/bin/sh', ['-c', `cat > quote.mjs <<'CONCLEAR_FIXTURE'\n${brokenCode}CONCLEAR_FIXTURE\nrm pricing.json\n`], { cwd: project });
        const snapshot = await observed(point => point.entries.some(entry => entry.path === 'quote.mjs' && entry.hash === digest(brokenCode)) && !point.entries.some(entry => entry.path === 'pricing.json'));
        testResult = await tests(project);
        if (testResult.passed) throw new Error('Broken fixture unexpectedly passed');
        record('shell-overwrite-and-delete', { snapshotId: snapshot.id, testsPassed: false });
      } else {
        const destination = join(root, 'recovered-checkout');
        const result = await restore(store, protectedId, destination);
        const verified = await tests(destination);
        if (!verified.passed) throw new Error('Restored fixture tests failed');
        recovered = destination;
        testResult = verified;
        if (Number((await git(['rev-list', '--count', 'HEAD'])).stdout.trim()) !== 1) throw new Error('Demo Git history changed unexpectedly');
        const originalStillBroken = !(await tests(project)).passed;
        if (!originalStillBroken) throw new Error('Original workspace was unexpectedly repaired');
        record('restored-and-tested', { snapshotId: protectedId, files: result.files, testsPassed: true, gitCommits: 1, recorderActive: recorder.status.watcher === 'active' && !recorder.stopping, originalStillBroken });
      }
      phase++;
      return state();
    } finally { busy = false; }
  }
  return { action, state, async close() { await recorder.stop(); await fs.rm(root, { recursive: true, force: true }); } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let demo;
  try {
    demo = await createDemo();
    if (process.argv.includes('--check')) {
      for (const action of ['working', 'pin', 'break', 'restore']) await demo.action(action);
      const result = await demo.state();
      console.log(JSON.stringify({ result: 'passed', commits: result.commits, evidence: result.evidence, limits: 'Disposable local fixture. Three fixture tests; no complete-capture or production-readiness claim.' }, null, 2));
      await demo.close();
    } else {
      const token = randomUUID();
      let mutating = false;
      const html = (await fs.readFile(join(dirname(fileURLToPath(import.meta.url)), 'demo.html'), 'utf8')).replace('__DEMO_TOKEN__', JSON.stringify(token));
      const server = createServer(async (req, res) => {
        const host = `127.0.0.1:${server.address().port}`;
        res.setHeader('Cache-Control', 'no-store');
        if (req.headers.host !== host) { res.writeHead(403); res.end(); return; }
        try {
          if (req.method === 'GET' && req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
          res.setHeader('Content-Type', 'application/json');
          if (req.method === 'GET' && req.url === '/api/state') { res.end(JSON.stringify(await demo.state())); return; }
          if (req.method === 'POST' && req.headers['x-demo-token'] === token && /^\/api\/(working|pin|break|restore|reset)$/.test(req.url)) {
            if (mutating) throw new Error('Another demo operation is running');
            mutating = true;
            try {
              if (req.url === '/api/reset') {
                const replacement = await createDemo();
                const previous = demo;
                demo = replacement;
                await previous.close();
                res.end(JSON.stringify(await demo.state()));
              } else res.end(JSON.stringify(await demo.action(req.url.slice(5))));
            } finally { mutating = false; }
            return;
          }
          res.writeHead(404); res.end('{}');
        } catch (error) { res.writeHead(409); res.end(JSON.stringify({ error: error.message })); }
      });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      console.log(`ConClear live demo: http://127.0.0.1:${server.address().port}\nDisposable fixtures only. Ctrl-C stops recording and removes the fixtures.`);
      let stopping = false;
      const stop = async () => {
        if (stopping) return;
        stopping = true;
        await new Promise(resolve => server.close(resolve));
        await demo.close();
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    }
  } catch (error) { console.error(error.message); await demo?.close(); process.exitCode = 1; }
}
