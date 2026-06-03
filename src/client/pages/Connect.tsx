import { useState } from 'react';
import { Icon } from '../lib/icons';
import { clsx } from '../lib/format';
import { Btn } from '../components/Btn';
import { StatusToggle } from '../components/StatusToggle';
import { CLIENTS, MCP_SERVER, type ClientStatus } from '../data/install-mock';

interface Props { toast: (type: 'success' | 'error', msg: string) => void }

export function Connect({ toast }: Props) {
  const [clients, setClients] = useState<ClientStatus[]>(CLIENTS);
  const [http, setHttp] = useState<boolean>(MCP_SERVER.httpRunning);
  const [showSnippet, setShowSnippet] = useState(false);

  const detected = clients.filter(c => c.detected);
  const installed = clients.filter(c => c.mcpInstalled).length;

  function toggleMcp(id: string) {
    setClients(cs => cs.map(c => c.id === id
      ? { ...c, mcpInstalled: !c.mcpInstalled, skillInstalled: !c.mcpInstalled ? c.skillInstalled : false }
      : c));
    const c = clients.find(x => x.id === id);
    if (!c) return;
    toast('success', c.mcpInstalled
      ? `Removed ConClear from ${c.name}`
      : `Installed ConClear MCP into ${c.name}`);
  }
  function toggleSkill(id: string) {
    setClients(cs => cs.map(c => c.id === id ? { ...c, skillInstalled: !c.skillInstalled } : c));
    const c = clients.find(x => x.id === id);
    if (!c) return;
    toast('success', c.skillInstalled ? `Removed Skill from ${c.name}` : `Installed ConClear Skill into ${c.name}`);
  }
  function installAllDetected() {
    setClients(cs => cs.map(c => c.detected ? { ...c, mcpInstalled: true } : c));
    toast('success', `Installed ConClear into ${detected.length} detected clients`);
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Connect</h1>
          <p className="page-sub">ConClear runs as an MCP server so your AI clients can query session history. Install it everywhere with one click — every edit is backed up.</p>
        </div>
        <div className="page-actions">
          <Btn icon="bolt" variant="primary" onClick={installAllDetected}>Install into {detected.length} detected</Btn>
        </div>
      </div>

      {/* MCP server status */}
      <div className="card panel" style={{ marginBottom: 'var(--gap)' }}>
        <div className="panel-head">
          <div className="panel-title">
            <span className={clsx('live-dot', MCP_SERVER.running && 'live')} /> MCP server
            <span className="tag" style={{ marginLeft: 4 }}>{MCP_SERVER.running ? 'running' : 'stopped'}</span>
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
            <div className="mt-sub mono">http://localhost:{MCP_SERVER.httpPort}/</div>
            <StatusToggle on={http} label={http ? 'on' : 'off'} onClick={() => {
              setHttp(h => !h);
              toast('success', http ? 'HTTP transport stopped' : `HTTP transport on :${MCP_SERVER.httpPort}`);
            }} />
          </div>
        </div>
        {showSnippet && (
          <div className="codeview" style={{ marginTop: 12 }}>
            <div className="codeview-head">
              <span className="fc-path" style={{ fontSize: 12 }}>~/.config/mcp.json</span>
              <span style={{ flex: 1 }} />
              <Btn icon="copy" variant="ghost" size="sm" onClick={() => {
                void navigator.clipboard.writeText(JSON.stringify(MCP_SERVER.entry, null, 2));
                toast('success', 'Config copied');
              }}>Copy</Btn>
            </div>
            <div className="codeview-body">
              <pre style={{ padding: 14 }}>
                <span className="ctext">{JSON.stringify(MCP_SERVER.entry, null, 2)}</span>
              </pre>
            </div>
          </div>
        )}
        <div className="divider" />
        <div className="mcp-tools-title">Tools exposed to agents</div>
        <div className="mcp-tools">
          {MCP_SERVER.tools.map(t => (
            <div className="mcp-tool" key={t.name}>
              <span className="mono mcp-tool-name">{t.name}</span>
              <span className="mcp-tool-desc">{t.desc}</span>
            </div>
          ))}
        </div>
      </div>

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
                onClick={() => toggleMcp(c.id)}
                disabled={!c.detected && c.method !== 'manual'}
              />
              {c.supportsSkill
                ? <StatusToggle on={c.skillInstalled} label="Skill" onClick={() => toggleSkill(c.id)} disabled={!c.mcpInstalled} />
                : <span className="cc-noskill">no skill</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
