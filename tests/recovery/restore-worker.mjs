import { restore } from '../../tools/recovery/recorder.mjs';
const released = new Promise(resolve => process.once('message', resolve));
try {
  const result = await restore(process.argv[2], process.argv[3], process.argv[4], {
    checkpoint: async () => { process.send({ event: 'verified' }); await released; },
  });
  process.send({ event: 'restored', result });
} catch (error) { process.send({ event: 'error', message: error.message }); }
process.disconnect();
