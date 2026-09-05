import { Recorder } from '../../tools/recovery/recorder.mjs';
import { basename, dirname } from 'node:path';

let armed;
const recorder = await new Recorder(process.argv[2], process.argv[3], {
  notifications: false,
  intervalMs: 60000,
  storageCheckpoint: async (phase, path) => {
    if (armed?.phase === phase && armed.kind === basename(dirname(path))) {
      process.send({ event: 'paused', phase, path });
      await new Promise(() => {}); // Parent sends SIGKILL at this exact storage boundary.
    }
  },
}).start();
process.send({ event: 'ready', snapshot: recorder.status.lastSnapshot });
process.on('message', async target => {
  armed = target;
  try {
    if (target.targeted) await recorder.scan('notification', ['code.ts']);
    else await recorder.capture('crash-injection');
    process.send({ event: 'unexpected-completion' });
  }
  catch (error) { process.send({ event: 'error', message: error.message }); }
});
