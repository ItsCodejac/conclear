import { useState } from 'react';
import { Icon } from '../lib/icons';
import { clsx } from '../lib/format';
import { Btn } from '../components/Btn';
import { StatusToggle } from '../components/StatusToggle';
import { useInstall, type InstallStatus, type ActionResult } from '../hooks/useInstall';

interface Props { toast: (type: 'success' | 'error', msg: string) => void }

export function Connect({ toast }: Props) {
  const { clients, mcp, loading, acting, refresh, installMcp, uninstallMcp, installSkill, uninstallSkill, installAllDetected } = useInstall();
  const [showSnippet, setShowSnippet] = useState(false);
  const [manualFor, setManualFor] = useState<{ client: InstallStatus; result: ActionResult } | null>(null);
  const [cardNote, setCardNote] = useState<Record<string, string>>({});

  const detected = clients.filter(c => c.detected);
  const installed = clients.filter(c => c.mcpInstalled).length;

  async function toggleMcp(c: InstallStatus) {
    const result = await (c.mcpInstalled ? uninstallMcp(c.id) : installMcp(c.id));
    if (!result.ok) {
      toast('error', result.error ?? result.action);
      return;
    }
    // Manual-install clients return instructions instead of doing the install.
    if (result.manualInstructions) {
      setManualFor({ client: c, result });
    } else {
      toast('success', result.action + (result.followUp ? ` — ${result.followUp}` : ''));
      if (result.followUp) {
        setCardNote(n => ({ ...n, [c.id]: result.followUp! }));
      }
      await refresh();
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
          <p className="page-sub">
            ConClear runs as an MCP server so your AI clients can query session history. Install it everywhere with one click — every edit is backed up to <span className="mono" style={{ fontSize: 12 }}>~/.conclear/backups</span>.
          </p>
        </div>
        <div className="page-actions">
          <Btn icon="refresh" variant="ghost" onClick={() => void refresh()}>Refresh</Btn>
          <Btn icon="bolt" variant="primary" onClick={() => void bulkInstall()}
               disabled={detected.length === 0 || acting === 'bulk'}>
            {acting === 'bulk' ? 'Installing…' : `Install into ${detected.length} detected`}
          </Btn>
        </div>
      </div>

      {/* MCP server */}
      {mcp && (
        <div className="card panel" style={{ marginBottom: 'var(--gap)' }}>
          <div className="panel-head">
            <div className="panel-title">
              <Icon name="cpu" size={15} className="pt-ico" /> ConClear MCP server
            </div>
            <span className="panel-link" onClick={() => setShowSnippet(s => !s)}>
              <Icon name="copy" size={13} /> Manual config
            </span>
          </div>
          <p className="page-sub" style={{ margin: '0 0 12px' }}>
            Installing into a client wires that client to spawn <span className="mono" style={{ fontSize: 12 }}>conclear mcp</span> on demand. No persistent server runs in the background.
          </p>
          <div className="mcp-transports">
            <div className="mcp-tport">
              <div className="mt-name"><Icon name="bash" size={14} /> stdio</div>
              <div className="mt-sub">Default — every client below uses this. Spawned per request.</div>
            </div>
            <div className="mcp-tport">
              <div className="mt-name"><Icon name="cpu" size={14} /> Streamable HTTP</div>
              <div className="mt-sub mono">conclear mcp --http --port {mcp.httpPort}</div>
            </div>
          </div>
          {showSnippet && (
            <div className="codeview" style={{ marginTop: 12 }}>
              <div className="codeview-head">
                <span className="fc-path" style={{ fontSize: 12 }}>JSON entry for any MCP-config-based client</span>
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
        {clients.map(c => {
          const mcpKey = `${c.id}:mcp:${c.mcpInstalled ? 'uninstall' : 'install'}`;
          const skillKey = `${c.id}:skill:${c.skillInstalled ? 'uninstall' : 'install'}`;
          const mcpBusy = acting === mcpKey;
          const skillBusy = acting === skillKey;
          return (
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
              {c.notes.map((n, i) => (
                <div className="cc-note" key={i}><Icon name="warn" size={11} /> {n}</div>
              ))}
              {cardNote[c.id] && (
                <div className="cc-note" style={{ color: 'var(--accent)' }}>
                  <Icon name="check" size={11} /> {cardNote[c.id]}
                </div>
              )}
              <div className="cc-actions">
                <StatusToggle
                  on={c.mcpInstalled}
                  label={mcpBusy ? '…' : 'MCP'}
                  onClick={() => void toggleMcp(c)}
                  disabled={(!c.detected && c.method !== 'manual') || mcpBusy}
                />
                {c.supportsSkill
                  ? <StatusToggle on={c.skillInstalled} label={skillBusy ? '…' : 'Skill'} onClick={() => void toggleSkill(c)} disabled={!c.mcpInstalled || skillBusy} />
                  : <span className="cc-noskill">no skill</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Manual-install modal (Continue, etc) */}
      {manualFor && (
        <div className="overlay" onClick={() => setManualFor(null)}>
          <div className="palette" style={{ width: 'min(720px, 92vw)' }} onClick={e => e.stopPropagation()}>
            <div className="palette-input" style={{ borderBottom: '1px solid var(--line)' }}>
              <Icon name="copy" size={18} style={{ color: 'var(--muted2)' }} />
              <span style={{ flex: 1, fontWeight: 600 }}>
                Manual install — {manualFor.client.name}
              </span>
              <span className="kbd">ESC</span>
            </div>
            <div style={{ padding: '14px 17px 18px' }}>
              <p className="page-sub" style={{ margin: '0 0 12px' }}>
                {manualFor.client.name} uses a config format ConClear can't safely auto-edit. Paste this snippet into the file below — every other client we touch is auto-installed.
              </p>
              {manualFor.result.manualInstructions ? (
                <div className="codeview">
                  <div className="codeview-head">
                    <Icon name="file" size={14} style={{ color: 'var(--muted2)' }} />
                    <span className="fc-path" style={{ fontSize: 12 }}>{manualFor.client.name} config</span>
                    <span style={{ flex: 1 }} />
                    <Btn icon="copy" variant="ghost" size="sm" onClick={() => {
                      void navigator.clipboard.writeText(manualFor.result.manualInstructions!);
                      toast('success', 'Snippet copied');
                    }}>Copy</Btn>
                  </div>
                  <div className="codeview-body">
                    <pre style={{ padding: 14, whiteSpace: 'pre-wrap' }}>
                      <span className="ctext">{manualFor.result.manualInstructions}</span>
                    </pre>
                  </div>
                </div>
              ) : (
                <p>{manualFor.result.action}</p>
              )}
              <div className="modal-actions" style={{ marginTop: 16 }}>
                <Btn variant="ghost" onClick={() => setManualFor(null)}>Close</Btn>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
