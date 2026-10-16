import { useCallback, useEffect, useState } from 'react';
import { Btn } from '../components/Btn';
import { fmtBytes } from '../lib/format';

interface Policy { maxBytes: number; maxSnapshots: number; mode: 'preserve' | 'expire' }
interface Project { id: string; name: string; path: string; enabled: boolean; state: string; policy: Policy; exclusions: string[]; error: string | null; updatedAt?: string; capture?: { lastSuccessfulScan?: string; lastFullScan?: string; lastError?: { message: string }; failedScanCount?: number; watcher?: string; storage?: { reservedPayloadBytes: number; snapshots: number }; metrics?: { files: number }; skipped?: { path: string; reason: string }[] } }
interface Health { running: boolean; demo?: boolean; projects: Project[]; service: { installed: boolean; supported: boolean } | null }
interface Point { id: string; finishedAt: string; files: number; skipped: number; scope: string; pin: { reason: string } | null }
interface PointPage { snapshots: Point[]; total: number; nextOffset: number | null }
interface Props { toast: (type: 'success' | 'error', msg: string) => void }

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/api/recovery' + path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Recovery request failed');
  return value;
}
const date = (value?: string) => value ? new Date(value).toLocaleString() : 'No successful capture yet';

function PolicyForm({ initial, exclusions, label, onSave, disabled }: { initial: Policy; exclusions: string[]; label: string; onSave: (policy: Policy, exclusions: string[]) => Promise<void>; disabled: boolean }) {
  const [mb, setMb] = useState(String(initial.maxBytes / 1048576));
  const [keep, setKeep] = useState(String(initial.maxSnapshots));
  const [mode, setMode] = useState(initial.mode);
  const [ignore, setIgnore] = useState(exclusions.join(', '));
  return <form className="recovery-form" onSubmit={e => { e.preventDefault(); void onSave({ maxBytes: Math.round(Number(mb) * 1048576), maxSnapshots: Number(keep), mode }, ignore.split(',').map(s => s.trim()).filter(Boolean)); }}>
    <label>Storage budget (MiB)<input type="number" min="1" step="1" required value={mb} onChange={e => setMb(e.target.value)} /></label>
    <label>Recovery point limit<input type="number" min="2" step="1" required value={keep} onChange={e => setKeep(e.target.value)} /></label>
    <label>When full<select value={mode} onChange={e => setMode(e.target.value as Policy['mode'])}><option value="preserve">Preserve history; pause capture</option><option value="expire">Expire older unpinned points</option></select></label>
    <label className="recovery-wide">Additional exclusions (relative paths, comma separated)<input value={ignore} onChange={e => setIgnore(e.target.value)} placeholder=".env, .env.local, build" /></label>
    {mode === 'expire' && <p className="recovery-warning recovery-wide">Expiration can delete older history immediately. The baseline, newest point, and pinned points stay protected.</p>}
    <button className="btn btn-primary btn-md" disabled={disabled} type="submit">{label}</button>
  </form>;
}

export function Recovery({ toast }: Props) {
  const [status, setStatus] = useState<Health | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [path, setPath] = useState('');
  const [selected, setSelected] = useState('');
  const [points, setPoints] = useState<PointPage>({ snapshots: [], total: 0, nextOffset: null });
  const [offset, setOffset] = useState(0);
  const [pointId, setPointId] = useState('');
  const [reason, setReason] = useState('');
  const [destination, setDestination] = useState('');
  const [receipt, setReceipt] = useState('');
  const refresh = useCallback(async () => {
    try {
      const value = await api<Health>('/status'); setStatus(value); setError('');
      if (selected) setPoints(await api<PointPage>(`/projects/${selected}/snapshots?offset=${offset}`));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [selected, offset]);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 3000); return () => clearInterval(timer); }, [refresh]);
  async function action(work: () => Promise<unknown>, message: string) {
    setBusy(true);
    try { await work(); toast('success', message); }
    catch (e) { toast('error', e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); await refresh(); }
  }
  const project = status?.projects.find(p => p.id === selected);
  const point = points.snapshots.find(p => p.id === pointId);
  const disabled = busy || !!status?.demo;
  return <div className="page recovery-page">
    <div className="page-head"><div><h1 className="page-title">Recovery</h1><p className="page-sub">Automatic local file history, independent of agents and Git commits.</p></div><Btn icon="refresh" onClick={() => void refresh()}>Refresh</Btn></div>
    {error && <p role="alert" className="recovery-warning">{error}</p>}
    {status?.demo && <p className="recovery-warning">Recovery management is disabled in session demo mode. Run ConClear without --demo to enroll a local project.</p>}
    <section className="recovery-card"><div className="recovery-heading"><h2>Background observer</h2><span className={status?.running ? 'recovery-good' : 'recovery-warning'}>{status?.running ? 'Running · fresh heartbeat' : 'Offline · capture is not confirmed'}</span></div>
      <p>Closing this page does not stop an installed observer. Capture health is reported separately for each project.</p>
      <div className="recovery-actions"><Btn variant="primary" disabled={disabled} onClick={() => void action(() => api('/service/install', 'POST'), 'Login service installed; check capture health below')}>{status?.service?.installed ? 'Repair / restart service' : 'Enable background service'}</Btn><Btn disabled={disabled} onClick={() => void action(() => api('/service/stop', 'POST'), 'Observer stopped until started again or next login')}>Stop observer</Btn><Btn disabled={disabled || !status?.service?.installed} onClick={() => void action(() => api('/service/uninstall', 'POST'), 'Service removed; captured history preserved')}>Remove service</Btn></div>
      <p className="recovery-note">Automatic startup uses macOS launchd or Linux systemd --user. Other platforms can use <code>conclear recovery run</code>.</p>
    </section>
    <details className="recovery-card" open={!status?.projects.length}><summary>Enroll a project</summary><p>Only enrolled directories are observed. Included files are stored locally as full bytes. Review exclusions before enabling capture.</p>
      <label className="recovery-path">Absolute project directory<input required value={path} onChange={e => setPath(e.target.value)} placeholder="/path/to/your/project" /></label>
      <PolicyForm initial={{ maxBytes: 536870912, maxSnapshots: 200, mode: 'preserve' }} exclusions={['.env', '.env.local']} label="Enroll and start background capture" disabled={disabled || !path.trim()} onSave={async (policy, exclusions) => { await action(async () => { const p = await api<Project>('/projects', 'POST', { path, policy, exclusions }); setSelected(p.id); setOffset(0); setPath(''); }, 'Project enrolled; initial capture is starting'); }} />
    </details>
    <div className="recovery-projects">{status?.projects.map(p => <button key={p.id} className={`recovery-project ${selected === p.id ? 'selected' : ''}`} onClick={() => { setSelected(p.id); setOffset(0); setPointId(''); setReceipt(''); }}><strong>{p.name}</strong><span>{p.state}</span><small>{p.path}</small></button>)}</div>
    {project && <section className="recovery-card"><div className="recovery-heading"><h2>{project.name}</h2><Btn disabled={disabled} onClick={() => void action(() => api(`/projects/${project.id}`, 'PATCH', { enabled: !project.enabled }), project.enabled ? 'Project paused; history preserved' : 'Project enabled; check observer status')}>{project.enabled ? 'Pause project' : 'Resume project'}</Btn></div>
      <p className="mono">{project.path}</p>
      <dl className="recovery-stats"><div><dt>Capture state</dt><dd>{project.state}</dd></div><div><dt>Last successful scan</dt><dd>{date(project.capture?.lastSuccessfulScan)}</dd></div><div><dt>Last full reconciliation</dt><dd>{date(project.capture?.lastFullScan)}</dd></div><div><dt>Storage / points</dt><dd>{fmtBytes(project.capture?.storage?.reservedPayloadBytes || 0)} / {fmtBytes(project.policy.maxBytes)} · {project.capture?.storage?.snapshots || 0} / {project.policy.maxSnapshots}</dd></div><div><dt>Watcher / recorded failures</dt><dd>{project.capture?.watcher || 'waiting'} · {project.capture?.failedScanCount || 0}</dd></div></dl>
      {(project.error || project.capture?.lastError) && <p role="alert" className="recovery-warning">{project.error || project.capture?.lastError?.message}</p>}
      {project.state === 'storage-full' && <p className="recovery-warning">New capture is paused. Increase limits below or explicitly choose expiration. Existing points are preserved.</p>}
      <details><summary>Coverage and storage settings</summary><p>Always skips .git, node_modules, dist, .DS_Store, symlinks, special files, and files over 16 MiB. .gitignore is not applied. Other included files may contain sensitive content.</p><PolicyForm key={project.id + project.updatedAt} initial={project.policy} exclusions={project.exclusions} label="Save capture settings" disabled={disabled} onSave={async (policy, exclusions) => { await action(() => api(`/projects/${project.id}`, 'PATCH', { policy, exclusions }), 'Settings saved; observer will rescan'); }} /><ul>{project.capture?.skipped?.slice(0, 20).map(s => <li key={s.path}>{s.path} · {s.reason}</li>)}</ul>{(project.capture?.skipped?.length || 0) > 20 && <p>Showing the first 20 omissions. Full coverage details are available in recovery status.</p>}</details>
      <h3>Captured points <small>({points.total})</small></h3><p className="recovery-note">A point preserves observed bytes. It is not an atomic or certified working project state.</p>
      <div className="recovery-points">{points.snapshots.map(p => <button key={p.id} className={`recovery-point ${p.id === pointId ? 'selected' : ''}`} onClick={() => { setPointId(p.id); setReason(''); setReceipt(''); }}><span>{date(p.finishedAt)}</span><span>{p.files} files · {p.skipped} omitted · {p.scope}</span><strong>{p.pin ? `Pinned: ${p.pin.reason}` : 'Select to restore or pin'}</strong></button>)}</div>
      {!points.snapshots.length && <p>No captured points yet. Check observer and capture status above.</p>}
      <div className="recovery-actions"><Btn disabled={offset === 0} onClick={() => { setOffset(Math.max(0, offset - 50)); setPointId(''); }}>Newer points</Btn><Btn disabled={points.nextOffset === null} onClick={() => { setOffset(points.nextOffset || 0); setPointId(''); }}>Older points</Btn></div>
      {point && <div className="recovery-selection"><p className="mono">Selected: {point.id}</p><label>Pin / unpin reason<input value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} placeholder="Why this point should be preserved" /></label><Btn disabled={disabled || !reason.trim()} onClick={() => void action(() => api(`/projects/${project.id}/pin`, 'POST', { point: point.id, reason, remove: !!point.pin }), point.pin ? 'Point unpinned' : 'Point pinned and verified')}>{point.pin ? 'Unpin selected point' : 'Pin selected point'}</Btn><label>New restore directory<input value={destination} onChange={e => setDestination(e.target.value)} placeholder="/path/to/new-recovered-directory" /></label><Btn variant="primary" icon="restore" disabled={disabled || !destination.trim()} onClick={() => void action(async () => { const result = await api<{ destination: string; files: number }>(`/projects/${project.id}/restore`, 'POST', { point: point.id, destination }); setReceipt(`Verified and restored ${result.files} files to ${result.destination}`); }, 'Restored into a new directory')}>Verify and restore copy</Btn>{receipt && <p role="status" className="recovery-good">{receipt}</p>}</div>}
    </section>}
    <p className="recovery-note">Notifications can miss rapid intermediate writes. Reconciliation cannot recover bytes overwritten before observation. No capture occurs while offline, paused, full, or before enrollment. Restoration keeps the original workspace intact.</p>
  </div>;
}
