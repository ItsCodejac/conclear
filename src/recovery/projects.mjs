import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, basename, sep, parse } from 'node:path';
import { createHash } from 'node:crypto';
import { atomic } from './persistence.mjs';
import { withStoreLock, listSnapshots, setPin } from './control.mjs';
import { restore } from './recorder.mjs';
import { policy } from './storage.mjs';

export const dataRoot = () => join(resolve(process.env.CONCLEAR_HOME || join(homedir(), '.conclear')), 'recovery');
export const isDemo = () => !!process.env.CONCLEAR_DEMO_ROOT;
export function requireWritable() { if (isDemo()) throw new Error('Recovery management is disabled in session demo mode. Run ConClear without --demo.'); }
export async function initRoot(root = dataRoot()) {
  await fs.mkdir(join(root, 'stores'), { recursive: true, mode: 0o700 });
  await fs.chmod(root, 0o700);
  return root;
}
export async function readJSON(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export async function registry(root = dataRoot()) {
  const value = await readJSON(join(root, 'projects.json'), { version: 1, projects: [] });
  if (value.version !== 1 || !Array.isArray(value.projects) || value.projects.some(p => !/^[a-f0-9]{24}$/.test(p.id) || typeof p.path !== 'string' || typeof p.enabled !== 'boolean')) throw new Error('Invalid recovery project registry');
  return value;
}
export async function projectById(id, root = dataRoot()) {
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) throw new Error('Invalid project id; use recovery list');
  const project = (await registry(root)).projects.find(p => p.id === id);
  if (!project) throw new Error('Recovery project not found');
  return { ...project, store: join(root, 'stores', id) };
}
function exclusions(value = ['.env', '.env.local']) {
  if (!Array.isArray(value) || value.length > 100 || value.some(p => typeof p !== 'string' || !p || p.length > 1024 || p.startsWith('/') || p.split(/[\\/]/).some(x => !x || x === '.' || x === '..'))) throw new Error('Exclusions must be relative paths, without wildcards or parent traversal (up to 100)');
  return value;
}
export async function enroll(path, options = {}, root = dataRoot()) {
  requireWritable();
  if (typeof path !== 'string' || !path.trim()) throw new Error('Supply an absolute project directory');
  path = await fs.realpath(resolve(path));
  if (!(await fs.stat(path)).isDirectory() || path === parse(path).root || path === homedir()) throw new Error('Choose a project directory, not your home or filesystem root');
  await initRoot(root);
  const canonicalRoot = await fs.realpath(root);
  if (canonicalRoot === path || canonicalRoot.startsWith(path + sep) || path.startsWith(canonicalRoot + sep)) throw new Error('Project and recovery storage must be separate trees. Set CONCLEAR_HOME to an external directory.');
  const retention = policy(options.policy || {});
  const ignore = exclusions(options.exclusions);
  return withStoreLock(root, async () => {
    const value = await registry(root);
    if (value.projects.some(p => p.path === path)) throw new Error('Project already enrolled; use its id to resume or change settings');
    if (value.projects.some(p => p.path.startsWith(path + sep) || path.startsWith(p.path + sep))) throw new Error('Overlapping project directories are already enrolled');
    const project = { id: createHash('sha256').update(path).digest('hex').slice(0, 24), name: basename(path), path, enabled: true, policy: retention, exclusions: ignore, createdAt: new Date().toISOString() };
    await fs.mkdir(join(root, 'stores', project.id), { mode: 0o700 });
    value.projects.push(project);
    await atomic(join(root, 'projects.json'), JSON.stringify(value));
    return project;
  });
}
export async function updateProject(id, changes, root = dataRoot()) {
  requireWritable();
  await initRoot(root);
  return withStoreLock(root, async () => {
    const value = await registry(root);
    const project = value.projects.find(p => p.id === id);
    if (!project) throw new Error('Recovery project not found');
    if (changes.enabled !== undefined) {
      if (typeof changes.enabled !== 'boolean') throw new Error('enabled must be boolean');
      project.enabled = changes.enabled;
    }
    if (changes.policy !== undefined) project.policy = policy({ ...project.policy, ...changes.policy });
    if (changes.exclusions !== undefined) project.exclusions = exclusions(changes.exclusions);
    project.updatedAt = new Date().toISOString();
    await atomic(join(root, 'projects.json'), JSON.stringify(value));
    return project;
  });
}
export async function health(root = dataRoot()) {
  if (isDemo()) return { demo: true, running: false, state: 'demo', projects: [] };
  const daemon = await readJSON(join(root, 'daemon.json'), null);
  let alive = false;
  if (daemon?.pid && daemon.state === 'running') {
    try { process.kill(daemon.pid, 0); alive = Date.now() - Date.parse(daemon.heartbeatAt) < 15000; } catch { /* Process exited. */ }
  }
  const projects = await Promise.all((await registry(root)).projects.map(async project => {
    const capture = await readJSON(join(root, 'stores', project.id, 'status.json'), null);
    const worker = daemon?.projects?.[project.id];
    const state = !project.enabled ? 'paused' : !alive ? 'offline' : worker?.error ? 'error' : worker?.state === 'starting' ? 'starting' : capture?.state || 'waiting';
    return { ...project, state, capture, error: worker?.error || null };
  }));
  return { root, running: alive, state: alive ? 'running' : 'offline', daemon, projects };
}
export async function snapshots(id, { limit = 50, offset = 0 } = {}, root = dataRoot()) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0) throw new Error('Snapshot limit must be 1–200 and offset nonnegative');
  const project = await projectById(id, root);
  let all;
  try { all = (await listSnapshots(project.store)).reverse(); }
  catch (error) { if (error.code === 'ENOENT') all = []; else throw error; }
  return { snapshots: all.slice(offset, offset + limit), total: all.length, nextOffset: offset + limit < all.length ? offset + limit : null };
}
export async function pin(id, point, details, remove = false, root = dataRoot()) {
  requireWritable();
  return setPin((await projectById(id, root)).store, point, details, remove);
}
export async function restorePoint(id, point, destination, root = dataRoot()) {
  requireWritable();
  if (typeof destination !== 'string' || !destination.trim()) throw new Error('Supply a new restore destination directory');
  return restore((await projectById(id, root)).store, point, destination);
}
