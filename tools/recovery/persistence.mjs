import * as fs from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';

const decompress = promisify(gunzip);

export async function readSnapshot(path) {
  const snapshot = JSON.parse(await fs.readFile(path, 'utf8'));
  if (snapshot.inventoryEncoding !== undefined) {
    if (snapshot.inventoryEncoding !== 'gzip-base64' || snapshot.entries !== undefined || snapshot.skipped !== undefined) throw new Error('Invalid inventory encoding');
    const inventory = JSON.parse((await decompress(Buffer.from(snapshot.inventory, 'base64'), { maxOutputLength: 64 * 1024 * 1024 })).toString('utf8'));
    snapshot.entries = inventory.entries;
    snapshot.skipped = inventory.skipped;
    delete snapshot.inventory;
    delete snapshot.inventoryEncoding;
  }
  return snapshot;
}

export async function atomic(path, data, checkpoint) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  const handle = await fs.open(tmp, 'wx', 0o600);
  try {
    await checkpoint?.('opened', path);
    await handle.writeFile(data);
    await checkpoint?.('written', path);
    await handle.sync();
    await checkpoint?.('synced', path);
  } finally { await handle.close(); }
  await fs.rename(tmp, path);
  await checkpoint?.('renamed', path);
  const dir = await fs.open(dirname(path), 'r');
  try { await dir.sync(); } finally { await dir.close(); }
  await checkpoint?.('durable', path);
}
