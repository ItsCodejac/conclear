import { Recorder, restore } from './recorder.mjs';

const [command, projectOrStore, storeOrId, ...extra] = process.argv.slice(2);
try {
  if (command === 'watch' && projectOrStore && storeOrId) {
    const options = {};
    for (let i = 0; i < extra.length; i += 2) {
      const key = { '--max-bytes': 'maxBytes', '--keep': 'maxSnapshots' }[extra[i]];
      if (!key || !/^\d+$/.test(extra[i + 1] ?? '') || key in options) throw new Error('Use --max-bytes BYTES and/or --keep COUNT once each');
      options[key] = Number(extra[i + 1]);
    }
    const recorder = await new Recorder(projectOrStore, storeOrId, options).start();
    console.log(JSON.stringify({ event: 'ready', ...recorder.status }));
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      await recorder.stop();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } else if (command === 'restore' && projectOrStore && storeOrId && extra.length === 1) {
    console.log(JSON.stringify(await restore(projectOrStore, storeOrId, extra[0])));
  } else {
    throw new Error('Prototype usage: node tools/recovery/cli.mjs watch PROJECT STORE [--max-bytes BYTES] [--keep COUNT] | restore STORE SNAPSHOT_ID NEW_DIRECTORY');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
