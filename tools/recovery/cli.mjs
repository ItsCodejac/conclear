import { Recorder, restore } from './recorder.mjs';
import { listSnapshots, setPin } from './control.mjs';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';

function options(args, allowed) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = Object.hasOwn(allowed, args[i]) ? allowed[args[i]] : null;
    if (!key || args[i + 1] === undefined || key in result) throw new Error(`Expected unique option/value pairs: ${Object.keys(allowed).join(', ')}`);
    result[key] = args[i + 1];
  }
  return result;
}

const [command, projectOrStore, storeOrId, ...extra] = process.argv.slice(2);
try {
  if (command === 'watch' && projectOrStore && storeOrId) {
    const settings = options(extra, { '--max-bytes': 'maxBytes', '--keep': 'maxSnapshots', '--retention': 'retentionMode' });
    for (const key of ['maxBytes', 'maxSnapshots']) if (key in settings) {
      if (!/^\d+$/.test(settings[key])) throw new Error(`${key} must be an integer`);
      settings[key] = Number(settings[key]);
    }
    const recorder = await new Recorder(projectOrStore, storeOrId, settings).start();
    console.log(JSON.stringify({ event: 'ready', ...recorder.status }));
    let lastState = recorder.status.state;
    const monitor = setInterval(async () => {
      try {
        const status = JSON.parse(await fs.readFile(join(recorder.store, 'status.json'), 'utf8'));
        if (status.state !== lastState) {
          lastState = status.state;
          console.log(JSON.stringify({ event: 'state-changed', state: status.state, lastError: status.lastError, retryAfter: status.retryAfter, storage: status.storage }));
        }
      } catch (error) { console.error(`Cannot read recorder status: ${error.message}`); }
    }, 1000);
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      clearInterval(monitor);
      try { await recorder.stop(); } catch (error) { console.error(error.message); process.exitCode = 1; }
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } else if (command === 'restore' && projectOrStore && storeOrId && extra.length === 1) {
    console.log(JSON.stringify(await restore(projectOrStore, storeOrId, extra[0])));
  } else if (command === 'list' && projectOrStore && !storeOrId) {
    console.log(JSON.stringify(await listSnapshots(projectOrStore), null, 2));
  } else if (['pin', 'unpin'].includes(command) && projectOrStore && storeOrId) {
    const settings = options(extra, { '--reason': 'reason', '--by': 'actor', '--source': 'sourceRef' });
    console.log(JSON.stringify(await setPin(projectOrStore, storeOrId, settings, command === 'unpin')));
  } else {
    throw new Error('Prototype usage: node tools/recovery/cli.mjs watch PROJECT STORE [--max-bytes BYTES] [--keep COUNT] [--retention preserve|expire] | list STORE | pin|unpin STORE SNAPSHOT_ID --reason TEXT [--by user|agent] [--source REF] | restore STORE SNAPSHOT_ID NEW_DIRECTORY');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
