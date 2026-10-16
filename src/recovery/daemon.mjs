import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Recorder } from './recorder.mjs';
import { atomic } from './persistence.mjs';
import { acquireLease } from './locks.mjs';
import { dataRoot, initRoot, registry, requireWritable } from './projects.mjs';

export async function runDaemon(root = dataRoot()) {
  requireWritable();
  await initRoot(root);
  const release = await acquireLease(join(root, 'daemon.sqlite'), { timeoutMs: 0, message: 'Recovery observer is already running' });
  const workers = new Map();
  let stopping = false;
  let wake;
  const stop = () => { stopping = true; wake?.(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  const status = { version: 1, pid: process.pid, state: 'running', startedAt: new Date().toISOString(), projects: {} };
  const writeHealth = async () => {
    status.heartbeatAt = new Date().toISOString();
    status.projects = Object.fromEntries([...workers].map(([id, w]) => [id, { state: w.state, error: w.error || null }]));
    await atomic(join(root, 'daemon.json'), JSON.stringify(status));
  };
  try {
    while (!stopping) {
      const selected = (await registry(root)).projects.filter(p => p.enabled);
      for (const [id, worker] of workers) {
        const project = selected.find(p => p.id === id);
        if (!project || worker.signature !== JSON.stringify(project)) {
          await worker.started;
          await worker.recorder.stop();
          workers.delete(id);
        }
      }
      for (const project of selected) {
        let worker = workers.get(project.id);
        if (worker?.state === 'error' && Date.now() >= worker.retryAt) { workers.delete(project.id); worker = undefined; }
        if (worker) continue;
        const recorder = new Recorder(project.path, join(root, 'stores', project.id), { maxBytes: project.policy.maxBytes, maxSnapshots: project.policy.maxSnapshots, retentionMode: project.policy.mode, exclusions: project.exclusions });
        worker = { recorder, signature: JSON.stringify(project), state: 'starting' };
        workers.set(project.id, worker);
        const current = worker;
        current.started = recorder.start().then(() => { current.state = 'running'; }).catch(error => {
          current.state = 'error'; current.error = error.message; current.retryAt = Date.now() + 10000;
        });
      }
      await writeHealth();
      await new Promise(resolve => { wake = resolve; const timer = setTimeout(resolve, 1000); if (stopping) { clearTimeout(timer); resolve(); } });
      wake = undefined;
    }
  } finally {
    await Promise.allSettled([...workers.values()].map(async w => { await w.started; await w.recorder.stop(); }));
    status.state = 'stopped';
    await writeHealth().finally(release);
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf('--data-dir');
  runDaemon(index >= 0 ? process.argv[index + 1] : dataRoot()).catch(error => { console.error(error); process.exitCode = 1; });
}
