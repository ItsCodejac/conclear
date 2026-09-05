// Synthetic workload only. All mutations and restores stay in a fresh temp tree.
import * as fs from 'node:fs/promises';
import { tmpdir, platform, release } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Recorder, restore } from './recorder.mjs';

const exec = promisify(execFile);
const fileCount = Number(process.argv[2] ?? 1000);
const fileBytes = Number(process.argv[3] ?? 16384);
if (!Number.isInteger(fileCount) || fileCount < 10 || fileCount > 10000 || !Number.isInteger(fileBytes) || fileBytes < 1024 || fileBytes > 1048576) throw new Error('Usage: node tools/recovery/stress.mjs [files:10..10000] [bytes:1024..1048576]');
const digest = data => createHash('sha256').update(data).digest('hex');
const root = await fs.mkdtemp(join(tmpdir(), 'conclear-recovery-stress-'));
const project = join(root, 'project'), store = join(root, 'store');
const writer = fileURLToPath(new URL('./stress-writer.mjs', import.meta.url));
let recorder;
const checkpoints = [];
const scans = [];
const report = { environment: { node: process.version, platform: platform(), release: release() }, fileCount, fileBytes, phases: [] };
const progress = text => process.stderr.write(`${text}\n`);
const percentile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1] : null;
const content = i => Buffer.from(`${i}:`.padEnd(fileBytes, 'b'));
async function storageBytes() {
  const totals = {};
  for (const dir of ['objects', 'snapshots']) {
    const files = await fs.readdir(join(store, dir));
    let bytes = 0;
    for (const file of files) bytes += (await fs.stat(join(store, dir, file))).size;
    totals[dir] = { files: files.length, bytes };
  }
  return totals;
}
async function settle(predicate) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Observer did not capture settled final state within 30 seconds');
}
try {
  await fs.mkdir(project);
  for (let i = 0; i < fileCount; i++) await fs.writeFile(join(project, `file-${String(i).padStart(5, '0')}.ts`), content(i));
  recorder = new Recorder(project, store, {
    intervalMs: 1000,
    storageCheckpoint: async (phase, path) => {
      if (phase === 'durable' && path.includes('/snapshots/')) checkpoints.push({ path, publishedAt: Date.now() });
    },
  });
  const scan = recorder.scan.bind(recorder);
  recorder.scan = async reason => {
    const start = performance.now();
    try {
      const result = await scan(reason);
      scans.push({ ok: true, reason, ...recorder.status.metrics });
      return result;
    } catch (error) {
      scans.push({ ok: false, reason, durationMs: performance.now() - start, error: error.message });
      throw error;
    }
  };
  let peakRssBytes = process.memoryUsage().rss;
  const sample = setInterval(() => { peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss); }, 25);
  sample.unref();
  try {
    progress(`Baseline: ${fileCount} files of ${fileBytes} bytes`);
    const baselineCpu = process.cpuUsage(), baselineStart = performance.now();
    await recorder.start();
    report.baseline = { elapsedMs: performance.now() - baselineStart, cpu: process.cpuUsage(baselineCpu), metrics: recorder.status.metrics };
    if (recorder.status.watcher !== 'active') throw new Error(`Notifications unavailable: ${recorder.status.watcherError}`);
    const baselineId = recorder.status.lastSnapshot;
    for (const spec of [{ name: 'paced-concurrent-writes', rounds: 80, delay: 20 }, { name: 'burst-concurrent-writes', rounds: 200, delay: 0 }]) {
      progress(spec.name);
      const scanStart = scans.length, checkpointStart = checkpoints.length;
      const cpu = process.cpuUsage(), began = performance.now();
      const beforeStorage = await storageBytes();
      const names = [`${spec.name}-inplace.ts`, `${spec.name}-rename.ts`];
      const outputs = await Promise.all(names.map((name, index) => exec(process.execPath, [writer, project, name, String(spec.rounds), String(spec.delay), String(fileBytes), index ? 'rename' : 'inplace'], { maxBuffer: 4 * 1024 * 1024 })));
      const records = outputs.flatMap(result => JSON.parse(result.stdout));
      const finalHashes = names.map(name => records.filter(record => record.file === name).at(-1).hash);
      const observed = new Map();
      let examined = checkpointStart;
      await settle(async () => {
        while (examined < checkpoints.length) {
          const point = checkpoints[examined++];
          const manifest = JSON.parse(await fs.readFile(point.path, 'utf8'));
          for (const entry of manifest.entries) {
            const key = `${entry.path}:${entry.hash}`;
            if (!observed.has(key)) observed.set(key, point.publishedAt);
          }
        }
        return finalHashes.every((hash, index) => observed.has(`${names[index]}:${hash}`));
      });
      const captured = records.filter(record => observed.has(`${record.file}:${record.hash}`));
      const delayMs = captured.map(record => Math.max(0, observed.get(`${record.file}:${record.hash}`) - record.completedAt));
      const phaseScans = scans.slice(scanStart);
      report.phases.push({ ...spec, completedWrites: records.length, capturedVersions: captured.length, missedVersions: records.length - captured.length,
        perWriter: names.map(file => ({ file, completed: records.filter(r => r.file === file).length, captured: captured.filter(r => r.file === file).length })),
        captureDelayMs: { p50: percentile(delayMs, 0.5), p95: percentile(delayMs, 0.95), max: Math.max(...delayMs) },
        elapsedMs: performance.now() - began, cpu: process.cpuUsage(cpu), successfulScans: phaseScans.filter(s => s.ok).length, failedScans: phaseScans.filter(s => !s.ok).length,
        scanP95Ms: percentile(phaseScans.map(s => s.durationMs), 0.95), beforeStorage, afterStorage: await storageBytes() });
    }
    progress('Bulk shell rename/delete, then validate baseline and final restoration');
    // Filenames are fixed by the harness; no user input is interpolated into shell code.
    await exec('/bin/sh', ['-c', 'mkdir moved; for f in file-000*.ts; do if [ -f "$f" ]; then mv "$f" moved/; fi; done; for f in file-001*.ts; do if [ -f "$f" ]; then rm "$f"; fi; done'], { cwd: project });
    const finalPoint = await recorder.capture('settled-bulk-check');
    const finalId = finalPoint?.id ?? recorder.status.lastSnapshot;
    await recorder.stop();
    const originalDir = join(root, 'original'), finalDir = join(root, 'final');
    await restore(store, baselineId, originalDir);
    for (let i = 0; i < fileCount; i++) {
      const restored = await fs.readFile(join(originalDir, `file-${String(i).padStart(5, '0')}.ts`));
      if (!restored.equals(content(i))) throw new Error(`Baseline restore mismatch: ${i}`);
    }
    await restore(store, finalId, finalDir);
    async function inventory(dir, prefix = '') {
      const result = [];
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) result.push(...await inventory(join(dir, entry.name), `${prefix}${entry.name}/`));
        else result.push([`${prefix}${entry.name}`, digest(await fs.readFile(join(dir, entry.name)))]);
      }
      return result.sort((a, b) => a[0].localeCompare(b[0]));
    }
    const expected = await inventory(project), actual = await inventory(finalDir);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Final tree restore mismatch');
    report.restoration = { baselineFilesVerified: fileCount, finalFilesVerified: actual.length, exactMatch: true };
    report.storage = await storageBytes();
    report.peakSampledRssBytes = peakRssBytes;
    report.scanFailures = scans.filter(s => !s.ok);
    report.persistedFailureCount = JSON.parse(await fs.readFile(join(store, 'status.json'), 'utf8')).failedScanCount;
    report.limits = ['Synthetic local workload; one run, not a real-world miss rate.', 'CPU measures this harness and recorder, excluding writer children; microseconds.', 'Capture delay covers captured versions only, from write completion to manifest publication; negative scheduling differences clamp to zero.', 'RSS includes harness; 25ms sampling may miss peaks. Process crashes are not power-loss tests.'];
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } finally { clearInterval(sample); }
} finally {
  await recorder?.stop();
  await fs.rm(root, { recursive: true, force: true });
}
