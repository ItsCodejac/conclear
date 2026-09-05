import { Recorder, restore } from './recorder.mjs';

const [command, projectOrStore, storeOrId, destination] = process.argv.slice(2);
try {
  if (command === 'watch' && projectOrStore && storeOrId && !destination) {
    const recorder = await new Recorder(projectOrStore, storeOrId).start();
    console.log(JSON.stringify({ event: 'ready', ...recorder.status }));
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      await recorder.stop();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } else if (command === 'restore' && projectOrStore && storeOrId && destination) {
    console.log(JSON.stringify(await restore(projectOrStore, storeOrId, destination)));
  } else {
    throw new Error('Prototype usage: node tools/recovery/cli.mjs watch PROJECT STORE | restore STORE SNAPSHOT_ID NEW_DIRECTORY');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
