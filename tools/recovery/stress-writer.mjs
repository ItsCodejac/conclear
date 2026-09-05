// A separate process keeps writer CPU out of the recorder's CPU measurement.
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const [project, name, roundsText, delayText, bytesText, mode] = process.argv.slice(2);
const rounds = Number(roundsText), delay = Number(delayText), bytes = Number(bytesText);
const records = [];
for (let version = 0; version < rounds; version++) {
  const data = Buffer.from(`${name}:${version}:`.padEnd(bytes, 'x'));
  const path = join(project, name);
  if (mode === 'rename') {
    await fs.writeFile(`${path}.pending`, data);
    await fs.rename(`${path}.pending`, path);
  } else await fs.writeFile(path, data);
  records.push({ file: name, version, hash: createHash('sha256').update(data).digest('hex'), completedAt: Date.now() });
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
}
process.stdout.write(JSON.stringify(records));
