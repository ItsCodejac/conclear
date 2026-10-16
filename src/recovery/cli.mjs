import { parseArgs } from 'node:util';
import { enroll, health, updateProject, snapshots, pin, restorePoint, isDemo } from './projects.mjs';
import { manageService, serviceStatus } from './service.mjs';
import { runDaemon } from './daemon.mjs';

export const recoveryHelp = `ConClear recovery — independent local file history

  conclear recovery add /absolute/project/path [--max-bytes N] [--keep N]
      [--retention preserve|expire] [--exclude relative/path,another/path] [--no-service]
  conclear recovery list | status [--json]
  conclear recovery pause PROJECT_ID | resume PROJECT_ID
  conclear recovery configure PROJECT_ID [--max-bytes N] [--keep N]
      [--retention preserve|expire] [--exclude relative/path,another/path]
  conclear recovery snapshots PROJECT_ID [--limit N] [--offset N] [--json]
  conclear recovery pin PROJECT_ID POINT_ID --reason "Reviewed working code" [--source REF]
  conclear recovery unpin PROJECT_ID POINT_ID --reason "No longer needed"
  conclear recovery restore PROJECT_ID POINT_ID /new/destination
  conclear recovery service install|start|stop|status|uninstall
  conclear recovery run                    Run in the foreground

Adding a project installs a login service on macOS or Linux systemd --user.
--no-service enrolls only; use 'run' to observe in the foreground.
Default: preserve published history; pause at 512 MiB or 200 recovery points.
Explicit 'expire' may delete older unpinned points. Pause/uninstall keeps history.
Restore verifies hashes and requires a NEW directory. No in-place rollback.
Notifications can miss intermediate writes. Points are not atomic project states.
`;

export async function runRecovery(args) {
  if (!args.length || args.includes('--help') || args.includes('-h')) { process.stdout.write(recoveryHelp); return; }
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    json: { type: 'boolean' }, 'no-service': { type: 'boolean' }, 'max-bytes': { type: 'string' }, keep: { type: 'string' }, retention: { type: 'string' }, exclude: { type: 'string' }, reason: { type: 'string' }, source: { type: 'string' }, by: { type: 'string' }, limit: { type: 'string' }, offset: { type: 'string' },
  } });
  const [command, id, point, destination] = positionals;
  const limits = {};
  if (values['max-bytes'] !== undefined) limits.maxBytes = Number(values['max-bytes']);
  if (values.keep !== undefined) limits.maxSnapshots = Number(values.keep);
  if (values.retention !== undefined) limits.mode = values.retention;
  const settings = { ...(Object.keys(limits).length ? { policy: limits } : {}), ...(values.exclude !== undefined ? { exclusions: values.exclude ? values.exclude.split(',') : [] } : {}) };
  let result;
  switch (command) {
    case 'add': {
      const project = await enroll(id, settings);
      result = { project, service: null, note: 'Enrolled; capture begins when an observer is running.' };
      if (!values['no-service']) {
        try { result.service = await manageService('install'); }
        catch (error) { throw new Error(`Project ${project.id} enrolled, but background startup failed: ${error.message}. Capture is not confirmed. Check 'recovery status', or use 'recovery run'.`); }
      }
      break;
    }
    case 'list': case 'status': result = { ...(await health()), service: isDemo() ? null : await serviceStatus() }; break;
    case 'pause': case 'resume': result = await updateProject(id, { enabled: command === 'resume' }); break;
    case 'configure': result = await updateProject(id, settings); break;
    case 'snapshots': result = await snapshots(id, { limit: values.limit === undefined ? 50 : Number(values.limit), offset: values.offset === undefined ? 0 : Number(values.offset) }); break;
    case 'pin': case 'unpin': result = await pin(id, point, { reason: values.reason, actor: values.by || 'user', sourceRef: values.source }, command === 'unpin'); break;
    case 'restore': result = await restorePoint(id, point, destination); break;
    case 'service': result = id === 'status' ? await serviceStatus() : await manageService(id); break;
    case 'run': process.stderr.write('ConClear recovery observer running; Ctrl-C stops capture.\n'); await runDaemon(); return;
    default: throw new Error(`Unknown recovery command: ${command}. Use conclear recovery --help.`);
  }
  process.stdout.write(JSON.stringify(result, null, values.json ? undefined : 2) + '\n');
}
