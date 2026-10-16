import { it, expect } from 'vitest';
import { createDemo } from '../../tools/recovery/demo.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { Script } from 'node:vm';

it('recovers actual uncommitted shell-written code without repairing the original workspace', async () => {
  const demo = await createDemo();
  try {
    const working = await demo.action('working');
    expect(working.testResult.passed).toBe(true);
    expect(working.commits).toBe(1);
    await demo.action('pin');
    const broken = await demo.action('break');
    expect(broken.testResult.passed).toBe(false);
    const recovered = await demo.action('restore');
    expect(recovered.phase).toBe(4);
    expect(recovered.commits).toBe(1);
    expect(recovered.evidence.at(-1)).toMatchObject({ files: 3, testsPassed: true, recorderActive: true, originalStillBroken: true });
    expect(recovered.snapshots.find(point => point.id === recovered.protectedId).pin).toMatchObject({ actor: 'user' });
    expect(recovered.sourceCode).not.toBe(recovered.recoveredCode);
    await expect(demo.action('working')).rejects.toThrow('Next action');
  } finally { await demo.close(); }
}, 15000);

it('serves the live demo, rejects invalid sequencing, and creates a fresh fixture on reset', async () => {
  const child = spawn(process.execPath, [resolve('tools/recovery/demo.mjs')], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  try {
    const deadline = performance.now() + 10000;
    while (!output.includes('http://127.0.0.1:')) {
      if (performance.now() > deadline || child.exitCode !== null) throw new Error(`Demo server did not start: ${output}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const base = output.match(/http:\/\/127\.0\.0\.1:\d+/)[0];
    const html = await (await fetch(base)).text();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    expect(() => new Script(script)).not.toThrow();
    const token = JSON.parse(script.match(/const token=("[^"]+")/)[1]);
    const post = action => fetch(`${base}/api/${action}`, { method: 'POST', headers: { 'x-demo-token': token } });
    expect((await post('restore')).status).toBe(409);
    expect((await fetch(`${base}/api/working`, { method: 'POST' })).status).toBe(404);
    const original = await (await fetch(`${base}/api/state`)).json();
    for (const action of ['working', 'pin', 'break', 'restore']) expect((await post(action)).ok).toBe(true);
    const reset = await (await post('reset')).json();
    expect(reset.phase).toBe(0);
    expect(reset.project).not.toBe(original.project);
    expect(reset.commits).toBe(1);
    expect(reset.protectedId).toBeNull();
    expect(reset.testResult.passed).toBe(false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended; }
  }
}, 20000);
