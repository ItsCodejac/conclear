// Reproducible small-fixture measurement; never records an existing project.
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Recorder, restore } from './recorder.mjs';

const root = await fs.mkdtemp(join(tmpdir(), 'conclear-recovery-measure-'));
let recorder;
try {
  const project = join(root, 'project');
  const store = join(root, 'store');
  await fs.mkdir(project);
  for (let i = 0; i < 100; i++) await fs.writeFile(join(project, `${i}.ts`), `${i}:` + 'x'.repeat(4096));
  recorder = await new Recorder(project, store, { notifications: false, intervalMs: 60000 }).start();
  const baseline = { ...recorder.status.metrics };
  const original = recorder.status.lastSnapshot;
  await recorder.capture('unchanged');
  const unchanged = { ...recorder.status.metrics };
  await fs.writeFile(join(project, '0.ts'), 'changed');
  await recorder.capture('single-change');
  const changed = { ...recorder.status.metrics };
  let objectBytes = 0, manifestBytes = 0;
  for (const file of await fs.readdir(join(store, 'objects'))) objectBytes += (await fs.stat(join(store, 'objects', file))).size;
  for (const file of await fs.readdir(join(store, 'snapshots'))) manifestBytes += (await fs.stat(join(store, 'snapshots', file))).size;
  const recovered = join(root, 'restored');
  await restore(store, original, recovered);
  for (let i = 0; i < 100; i++) {
    if ((await fs.readFile(join(recovered, `${i}.ts`), 'utf8')) !== `${i}:` + 'x'.repeat(4096)) throw new Error('Restoration mismatch');
  }
  console.log(JSON.stringify({ baseline, unchanged, changed, objectBytes, manifestBytes, restoredFiles: 100 }, null, 2));
} finally {
  await recorder?.stop();
  await fs.rm(root, { recursive: true, force: true });
}
