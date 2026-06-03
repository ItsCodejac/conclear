import { useState } from 'react';
import { Icon } from '../lib/icons';
import { clsx } from '../lib/format';
import { Btn } from '../components/Btn';
import { StatusToggle } from '../components/StatusToggle';
import { useInstall, type InstallStatus } from '../hooks/useInstall';

interface Props { toast: (type: 'success' | 'error', msg: string) => void }

export function Connect({ toast }: Props) {
  const { clients, mcp, loading, refresh, installMcp, uninstallMcp, installSkill, uninstallSkill, installAllDetected } = useInstall();
  const [showSnippet, setShowSnippet] = useState(false);

  const detected = clients.filter(c => c.detected);
  const installed = clients.filter(c => c.mcpInstalled).length;

  async function toggleMcp(c: InstallStatus) {
    const result = await (c.mcpInstalled ? uninstallMcp(c.id) : installMcp(c.id));
    if (result.ok) {
      toast('success', result.action + (result.followUp ? ` — ${result.followUp}` : ''));
      await refresh();
    } else {
      toast('error', result.error ?? result.action);
    }
  }

  async function toggleSkill(c: InstallStatus) {
    const result = await (c.skillInstalled ? uninstallSkill(c.id) : installSkill(c.id));
    if (result.ok) {
      toast('success', result.action);
      await refresh();
    } else {
      toast('error', result.error ?? result.action);
    }
  }

  async function bulkInstall() {
    const results = await installAllDetected();
    const ok = results.filter(r => r.ok).length;
    toast('success', `Installed ConClear into ${ok} detected client${ok === 1 ? '' : 's'}`);
    await refresh();
  }

  if (loading && clients.length === 0) {
    return (
      <div className="page">
        <div className="empty-state">
          <div className="es-ico"><Icon name="cpu" size={26} /></div>
          <div className="es-title">Loading client status…</div>
          <div>Probing every AI client for ConClear install state.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Connect</h1>
          <p className="page-sub">ConClear runs as an MCP server so your AI clients can query session history. Install it everywhere with one click — every edit is backed up.</p>
        </div>
        <div className="page-actions">
          <Btn icon="refresh" variant="ghost" onClick={() => void refresh()}>Refresh</Btn>
          <Btn icon="bolt" variant="primary" onClick={() => void bulkInstall()} disabled={detected.length === 0}>
            Install into {detected.length} detected
          </Btn>
        </div>
      </div>

      {/* MCP server status */}
      {mcp && (
        <div className="card panel" style={{ marginBottom: 'var(--gap)' }}>
          <div className="panel-head">
            <div className="panel-title">
              <span className={clsx('live-dot', mcp.running && 'live')} /> MCP server
              <span className="tag" style={{ marginLeft: 4 }}>{mcp.running ? 'running' : 'stopped'}</span>
            </div>
            <span className="panel-link" onClick={() => setShowSnippet(s => !s)}>
              <Icon name="copy" size={13} /> Manual config
            </span>
          </div>
          <div className="mcp-transports">
            <div className="mcp-tport">
              <div className="mt-name"><Icon name="bash" size={14} /> stdio</div>
              <div className="mt-sub">Default transport — used by Claude Code &amp; most clients</div>
              <span className="mcp-state on">active</span>
            </div>
            <div className="mcp-tport">
              <div className="mt-name"><Icon name="cpu" size={14} /> Streamable HTTP</div>
              <div className="mt-sub mono">conclear mcp --http --port {mcp.httpPort}</div>
              <span className="mcp-state" style={{ color: 'var(--muted2)' }}>off</span>
            </div>
          </div>
          {showSnippet && (
            <div className="codeview" style={{ marginTop: 12 }}>
              <div className="codeview-head">
                <span className="fc-path" style={{ fontSize: 12 }}>~/.config/mcp.json</span>
                <span style={{ flex: 1 }} />
                <Btn icon="copy" variant="ghost" size="sm" onClick={() => {
                  void navigator.clipboard.writeText(JSON.stringify(mcp.entry, null, 2));
                  toast('success', 'Config copied');
                }}>Copy</Btn>
              </div>
              <div className="codeview-body">
                <pre style={{ padding: 14 }}>
                  <span className="ctext">{JSON.stringify(mcp.entry, null, 2)}</span>
                </pre>
              </div>
            </div>
          )}
          <div className="divider" />
          <div className="mcp-tools-title">Tools exposed to agents</div>
          <div className="mcp-tools">
            {mcp.tools.map(t => (
              <div className="mcp-tool" key={t.name}>
                <span className="mono mcp-tool-name">{t.name}</span>
                <span className="mcp-tool-desc">{t.desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel-head" style={{ marginBottom: 12 }}>
        <div className="panel-title">
          <Icon name="grid" size={15} className="pt-ico" /> Clients
          <span className="pg-meta">{installed} installed · {detected.length} detected · {clients.length} supported</span>
        </div>
      </div>
      <div className="client-grid">
        {clients.map(c => (
          <div className={clsx('client-card', !c.detected && 'undetected', c.mcpInstalled && 'active')} key={c.id}>
            <div className="cc-top">
              <span className="cc-avatar">{c.name.slice(0, 1)}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="cc-name">{c.name}</div>
                <div className="cc-meta">
                  <span className={clsx('cc-detect', c.detected && 'yes')}>
                    {c.detected ? 'detected' : 'not installed'}
                  </span>
                  <span className="tag">{c.method}</span>
                </div>
              </div>
            </div>
            {c.notes[0] && (
              <div className="cc-note"><Icon name="warn" size={11} /> {c.notes[0]}</div>
            )}
            <div className="cc-actions">
              <StatusToggle
                on={c.mcpInstalled}
                label="MCP"
                onClick={() => void toggleMcp(c)}
                disabled={!c.detected && c.method !== 'manual'}
              />
              {c.supportsSkill
                ? <StatusToggle on={c.skillInstalled} label="Skill" onClick={() => void toggleSkill(c)} disabled={!c.mcpInstalled} />
                : <span className="cc-noskill">no skill</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
