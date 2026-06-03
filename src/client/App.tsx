import { useEffect, useMemo, useState } from 'react';
import { Logo } from './lib/Logo';
import { Icon } from './lib/icons';
import { clsx, fmtBytes } from './lib/format';
import { TOOLS, type ToolId } from './lib/types';
import { useSessions } from './hooks/useSessions';
import { useDerived } from './hooks/useDerived';
import { useToasts } from './hooks/useToasts';
import { Overview } from './pages/Overview';
import { Sessions } from './pages/Sessions';
import { Security } from './pages/Security';
import { Connect } from './pages/Connect';
import { Backups } from './pages/Backups';
import { Settings } from './pages/Settings';
import { Admin } from './pages/Admin';
import { Upgrade } from './pages/Upgrade';
import { CommandPalette } from './commands/CommandPalette';
import { ScanOverlay } from './extras/ScanOverlay';
import { WORKSPACES, ADMIN_STATS, type Workspace } from './data/admin-mock';
import { CLIENTS } from './data/install-mock';

type PageId = 'overview' | 'sessions' | 'security' | 'connect' | 'backups' | 'settings' | 'admin';

interface NavSpec { id: PageId; label: string; icon: Parameters<typeof Icon>[0]['name'] }
const NAV: NavSpec[] = [
  { id: 'overview', label: 'Reclaim',   icon: 'reclaim' },
  { id: 'sessions', label: 'Sessions',  icon: 'sessions' },
  { id: 'security', label: 'Security',  icon: 'shield' },
  { id: 'connect',  label: 'Connect',   icon: 'cpu' },
  { id: 'backups',  label: 'Backups',   icon: 'archive' },
  { id: 'admin',    label: 'Admin',     icon: 'org' },
];

export function App() {
  const { sessions, loading, refresh } = useSessions();
  const derived = useDerived(sessions);
  const { toasts, toast } = useToasts();

  const [page, setPage] = useState<PageId | 'settings'>('overview');
  const [projFilter, setProjFilter] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace>(WORKSPACES[0]);

  const plan = workspace.plan;

  // Global keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(v => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        setScanning(true);
      }
      if (e.key === 'Escape') setPaletteOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function gotoSessions(project?: string) {
    setProjFilter(project ?? null);
    setPage('sessions');
  }
  function openSession(id: string) {
    setOpenId(id);
    setProjFilter(null);
    setPage('sessions');
  }
  function rescan() {
    setScanning(true);
    void refresh();
  }

  const detectedTools = useMemo(() => [...new Set(sessions.map(s => s.tool))] as ToolId[], [sessions]);
  const installedClients = CLIENTS.filter(c => c.mcpInstalled).length;
  const navCounts: Partial<Record<PageId, number>> = {
    sessions: sessions.length,
    security: derived.totalSecrets,
    connect:  installedClients,
    backups:  0, // populated lazily on Backups page open
    admin:    plan !== 'free' ? ADMIN_STATS.openLeaks : undefined,
  };

  return (
    <div className="win">
      {/* titlebar */}
      <div className="titlebar">
        <div className="tb-left">
          <div className="traffic"><i className="r" /><i className="y" /><i className="g" /></div>
          <div className="tb-brand"><Logo size={22} /><span className="tb-name">Con<b>Clear</b></span></div>
          {plan !== 'free' && <span className={clsx('tb-plan', `plan-${plan}`)}>{workspace.name}</span>}
        </div>
        <div className="tb-center">
          <div className="cmdk" onClick={() => setPaletteOpen(true)}>
            <Icon name="search" size={15} />
            <span className="grow">Search all sessions, messages, files…</span>
            <span className="kbd">⌘K</span>
          </div>
        </div>
        <div className="tb-right">
          <div className="mcp-chip" title="ConClear MCP server is running" onClick={() => setPage('connect')}>
            <span className="live-dot live" /> MCP
          </div>
          <span className="pg-meta">{fmtBytes(derived.totalSize)}</span>
          <button className="iconbtn" title="Rescan (⌘R)" onClick={rescan}><Icon name="refresh" size={16} /></button>
        </div>
      </div>

      {/* body */}
      <div className="body">
        <nav className="rail">
          {/* workspace switcher would go here when wired */}
          {NAV.map(n => {
            const locked = n.id === 'admin' && plan === 'free';
            const count = navCounts[n.id];
            return (
              <div
                key={n.id}
                className={clsx('navitem', page === n.id && 'active', locked && 'locked')}
                onClick={() => {
                  setPage(n.id);
                  if (n.id !== 'sessions') setProjFilter(null);
                }}
              >
                <span className="ni-icon"><Icon name={n.icon} size={18} /></span>
                <span>{n.label}</span>
                {locked
                  ? <span className="ni-lock"><Icon name="lock" size={14} /></span>
                  : count != null && (
                    <span className={clsx('ni-count', (n.id === 'security' || n.id === 'admin') && count > 0 && 'alert')}>{count}</span>
                  )}
              </div>
            );
          })}
          <div className="rail-spacer" />
          <div
            className={clsx('navitem', page === 'settings' && 'active')}
            onClick={() => { setPage('settings'); setProjFilter(null); }}
            style={{ marginBottom: 4 }}
          >
            <span className="ni-icon"><Icon name="gear" size={18} /></span>
            <span>Settings</span>
          </div>
          <div className="rail-foot">
            <div className="tools-detected">
              <div className="td-title">Detected tools</div>
              {detectedTools.map(t => (
                <div className="td-row" key={t}>
                  <span
                    className="dot"
                    style={{ backgroundColor: ({ claude: '#d98a4f', cursor: '#e6e6e6', gemini: '#6aa6ff', cline: '#59d499', copilot: '#c79bff' })[t] }}
                  />
                  {TOOLS[t].label}
                </div>
              ))}
            </div>
          </div>
        </nav>

        <main className="main">
          {loading && sessions.length === 0 ? (
            <div className="page"><div className="empty-state"><div className="es-ico"><Logo size={32} /></div><div className="es-title">Loading sessions…</div></div></div>
          ) : (
            <>
              {page === 'overview' && <Overview sessions={sessions} onOpen={openSession} onGoto={gotoSessions} onRescan={rescan} onClean={() => toast('success', `Queued ${derived.problem.length} sessions — resizing oversized images`)} />}
              {page === 'sessions' && <Sessions sessions={sessions} projectFilter={projFilter} openId={openId} onOpenId={setOpenId} toast={toast} />}
              {page === 'security' && <Security sessions={sessions} onOpen={openSession} />}
              {page === 'connect'  && <Connect toast={toast} />}
              {page === 'backups'  && <Backups toast={toast} />}
              {page === 'settings' && <Settings toast={toast} />}
              {page === 'admin'    && (plan === 'free'
                ? <Upgrade onSwitch={setWorkspace} />
                : <Admin workspace={workspace} toast={toast} />)}
            </>
          )}
        </main>
      </div>

      {paletteOpen && (
        <CommandPalette
          sessions={sessions}
          onClose={() => setPaletteOpen(false)}
          onOpen={(id) => { openSession(id); setPaletteOpen(false); }}
        />
      )}
      {scanning && <ScanOverlay onDone={() => { setScanning(false); toast('success', `Rescan complete · ${sessions.length} sessions`); }} />}

      <div className="toasts">
        {toasts.map(t => (
          <div key={t.id} className={clsx('toast', t.type)}>
            <span className="t-ico"><Icon name={t.type === 'success' ? 'check' : 'error'} size={16} /></span>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
