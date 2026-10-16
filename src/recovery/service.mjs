import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dataRoot, initRoot, health, requireWritable } from './projects.mjs';

const exec = promisify(execFile);
const xml = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
const unitArg = s => '"' + String(s).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('$', '$$').replaceAll('\n', '\\n') + '"';
export function serviceSpec(root = dataRoot(), platform = process.platform, home = homedir()) {
  const suffix = createHash('sha256').update(root).digest('hex').slice(0, 12);
  const label = `com.conclear.recovery.${suffix}`;
  const args = [process.execPath, fileURLToPath(new URL('./daemon.mjs', import.meta.url)), '--data-dir', root];
  if (platform === 'darwin') return {
    supported: true, platform, label, path: join(home, 'Library', 'LaunchAgents', `${label}.plist`),
    content: `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map(a => `<string>${xml(a)}</string>`).join('')}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>StandardOutPath</key><string>${xml(join(root, 'observer.log'))}</string><key>StandardErrorPath</key><string>${xml(join(root, 'observer-error.log'))}</string></dict></plist>\n`,
  };
  if (platform === 'linux') {
    const label = `conclear-recovery-${suffix}.service`;
    return { supported: true, platform, label, path: join(home, '.config', 'systemd', 'user', label), content: `[Unit]\nDescription=ConClear local recovery observer\n\n[Service]\nType=simple\nExecStart=${args.map(unitArg).join(' ')}\nRestart=on-failure\nRestartSec=5\nUMask=0077\nStandardOutput=null\nStandardError=journal\n\n[Install]\nWantedBy=default.target\n` };
  }
  return { supported: false, platform, label, path: null, content: null };
}
export async function serviceStatus(root = dataRoot()) {
  const spec = serviceSpec(root);
  const installed = spec.path ? await fs.access(spec.path).then(() => true, () => false) : false;
  const state = await health(root);
  return { supported: spec.supported, platform: spec.platform, installed, running: state.running, state: state.state, path: spec.path, label: spec.label, heartbeatAt: state.daemon?.heartbeatAt || null };
}
export async function manageService(action, root = dataRoot(), { execute = exec, home = homedir(), platform = process.platform } = {}) {
  requireWritable();
  if (!['install', 'start', 'stop', 'uninstall'].includes(action)) throw new Error('Service action must be install, start, stop, or uninstall');
  const spec = serviceSpec(root, platform, home);
  if (!spec.supported) throw new Error('Automatic recovery service supports macOS launchd and Linux systemd --user. Use conclear recovery run on this platform.');
  await initRoot(root);
  const run = (command, args) => execute(command, args, { timeout: 15000, maxBuffer: 128 * 1024 });
  const exists = await fs.access(spec.path).then(() => true, () => false);
  if (action === 'install' || (action === 'start' && !exists)) {
    await fs.mkdir(dirname(spec.path), { recursive: true });
    await fs.writeFile(spec.path, spec.content, { mode: 0o600 });
  }
  if (platform === 'darwin') {
    const domain = `gui/${process.getuid()}`;
    const target = `${domain}/${spec.label}`;
    const loaded = await run('launchctl', ['print', target]).then(() => true, () => false);
    if (action === 'stop' || action === 'uninstall') {
      if (loaded) await run('launchctl', ['bootout', target]);
    } else {
      // Re-bootstrap on install so an upgrade replaces the executable path.
      if (loaded && action === 'install') await run('launchctl', ['bootout', target]);
      if (!loaded || action === 'install') await run('launchctl', ['bootstrap', domain, spec.path]);
      else await run('launchctl', ['kickstart', target]);
    }
  } else {
    if (action === 'install' || (action === 'start' && !exists)) await run('systemctl', ['--user', 'daemon-reload']);
    if (action === 'install' || action === 'start') await run('systemctl', ['--user', 'enable', '--now', spec.label]);
    else await run('systemctl', ['--user', action === 'uninstall' ? 'disable' : 'stop', ...(action === 'uninstall' ? ['--now'] : []), spec.label]);
  }
  if (action === 'uninstall') {
    await fs.unlink(spec.path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (platform === 'linux') await run('systemctl', ['--user', 'daemon-reload']);
  }
  return { action, label: spec.label, path: spec.path, historyPreserved: true };
}
