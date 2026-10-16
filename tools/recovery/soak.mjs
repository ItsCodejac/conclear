// Short sustained-operation experiment, always confined to disposable fixtures.
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Recorder, readSnapshot, restore } from './recorder.mjs';

const seconds = Number(process.argv[2] ?? 60);
if (!Number.isInteger(seconds) || seconds < 6 || seconds > 3600) throw new Error('Duration must be 6..3600 seconds');
const root = await fs.mkdtemp(join(tmpdir(), 'conclear-soak-'));
const project = join(root, 'project'), store = join(root, 'store');
const options = { maxBytes: 256 * 1024, maxSnapshots: 12, retentionMode: 'expire', intervalMs: 250 };
const hash = data => createHash('sha256').update(data).digest('hex');
const known = new Set([hash(Buffer.alloc(0))]);
const report = { seconds, options, cycles: [], writes: 0, peakPayloadBytes: 0, peakRssBytes: 0, restoredSnapshots: 0, restoredFiles: 0 };
let recorder;
async function sample() {
  let bytes = 0;
  for (const dir of ['objects', 'snapshots']) for (const name of await fs.readdir(join(store, dir))) {
    try { bytes += (await fs.stat(join(store, dir, name))).size; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  report.peakPayloadBytes = Math.max(report.peakPayloadBytes, bytes);
  report.peakRssBytes = Math.max(report.peakRssBytes, process.memoryUsage().rss);
  if (bytes > options.maxBytes) throw new Error('Payload exceeded configured budget');
}
try {
  await fs.mkdir(project);
  for (let i = 0; i < 50; i++) {
    const bytes = Buffer.from(`${i}:`.padEnd(1024, 'b'));
    known.add(hash(bytes));
    await fs.writeFile(join(project, `file-${i}.ts`), bytes);
  }
  let baseline;
  const began = performance.now(), cpu = process.cpuUsage();
  for (let cycle = 0; cycle < 3; cycle++) {
    recorder = await new Recorder(project, store, options).start();
    if (recorder.status.watcher !== 'active') throw new Error(`Watcher unavailable: ${recorder.status.watcherError}`);
    baseline ??= recorder.status.lastSnapshot;
    const until = performance.now() + seconds * 1000 / 3;
    while (performance.now() < until) {
      const bytes = Buffer.from(`write-${report.writes++}:`.padEnd(1024, 'w'));
      known.add(hash(bytes));
      await fs.writeFile(join(project, 'active.pending'), bytes);
      await fs.rename(join(project, 'active.pending'), join(project, 'active.ts'));
      await new Promise(resolve => setTimeout(resolve, 100));
      await sample();
    }
    await recorder.capture('settled-soak');
    await recorder.stop();
    const names = (await fs.readdir(join(store, 'snapshots'))).filter(name => name.endsWith('.json'));
    if (names.length > options.maxSnapshots || !names.includes(`${baseline}.json`)) throw new Error('Retention invariant failed');
    for (const name of names) {
      const point = await readSnapshot(join(store, 'snapshots', name));
      const destination = join(root, `restore-${cycle}-${point.id}`);
      await restore(store, point.id, destination);
      for (const entry of point.entries) {
        const bytes = await fs.readFile(join(destination, entry.path));
        if (hash(bytes) !== entry.hash || !known.has(entry.hash)) throw new Error('Restored bytes do not match a fixture write');
        report.restoredFiles++;
      }
      report.restoredSnapshots++;
      await fs.rm(destination, { recursive: true });
    }
    await sample();
    const memoryBeforeGc = process.memoryUsage();
    global.gc?.();
    report.cycles.push({ cycle, retained: names.length, failures: recorder.status.failedScanCount, storage: recorder.status.storage, memoryBeforeGc, memoryAfterGc: global.gc ? process.memoryUsage() : null });
    process.stderr.write(`Cycle ${cycle + 1}/3: ${report.writes} writes; ${names.length} retained points verified\n`);
  }
  report.elapsedMs = performance.now() - began;
  report.cpu = process.cpuUsage(cpu);
  report.limits = ['Single local fixture run, not a long-duration reliability guarantee.', 'Payload counts objects, manifests and temporary payload files; excludes metadata and filesystem allocation overhead.', 'CPU/RSS include harness and writer; memory samples do not prove absence of leaks. With --expose-gc, forced GC after each cycle is diagnostic only.', 'Graceful stop/restart each cycle; separate tests inject SIGKILL at storage and retention boundaries.'];
  console.log(JSON.stringify(report, null, 2));
} finally {
  await recorder?.stop();
  await fs.rm(root, { recursive: true, force: true });
}
