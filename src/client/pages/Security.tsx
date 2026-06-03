import { useEffect, useState } from 'react';
import { Icon } from '../lib/icons';
import { clsx, sevColor } from '../lib/format';
import { TOOLS, type Session, type SecretFinding } from '../lib/types';
import { Btn } from '../components/Btn';
import { ToolBadge } from '../components/ToolBadge';
import { SevPill } from '../components/SevPill';

interface Props {
  sessions: Session[];
  onOpen: (id: string) => void;
}

interface ScannedSession {
  session: Session;
  findings: SecretFinding[];
}

/** Lazily scan each scannable session via /api/sessions/:id/scan. */
function useOrgScan(sessions: Session[]) {
  const [rows, setRows] = useState<ScannedSession[]>([]);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function go() {
      setScanning(true);
      const scannable = sessions.filter(s => TOOLS[s.tool].caps.scanSecrets);
      const out: ScannedSession[] = [];
      for (const s of scannable) {
        try {
          const res = await fetch(`/api/sessions/${encodeURIComponent(s.id)}/scan`);
          if (res.ok) {
            const findings = (await res.json()) as SecretFinding[];
            if (findings.length > 0) out.push({ session: s, findings });
          }
        } catch { /* ignore */ }
        if (cancelled) return;
      }
      if (!cancelled) {
        out.sort((a, b) => b.findings.length - a.findings.length);
        setRows(out);
        setScanning(false);
      }
    }
    void go();
    return () => { cancelled = true; };
  }, [sessions]);

  return { rows, scanning };
}

export function Security({ sessions, onOpen }: Props) {
  const { rows, scanning } = useOrgScan(sessions);
  const total = rows.reduce((n, r) => n + r.findings.length, 0);
  const high = rows.reduce((n, r) => n + r.findings.filter(f => f.severity === 'high').length, 0);
  const scannable = sessions.filter(s => TOOLS[s.tool].caps.scanSecrets).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Security</h1>
          <p className="page-sub">Secrets the scanner found pasted into session files — keys, tokens, env dumps.</p>
        </div>
        <div className="page-actions"><Btn icon="refresh" variant="ghost">Rescan all</Btn></div>
      </div>

      <div className="grid-3" style={{ marginBottom: 'var(--gap)' }}>
        <div className="card statcard dangerstat">
          <div className="s-label"><Icon name="key" size={14} /> Secrets found</div>
          <div className="s-val">{total}</div>
          <div className="s-sub">across {rows.length} sessions</div>
        </div>
        <div className="card statcard">
          <div className="s-label"><Icon name="warn" size={14} /> High severity</div>
          <div className="s-val" style={{ color: 'var(--danger)' }}>{high}</div>
          <div className="s-sub">act on these first</div>
        </div>
        <div className="card statcard">
          <div className="s-label"><Icon name="shield" size={14} /> Scannable</div>
          <div className="s-val reclaim-num">{scannable}</div>
          <div className="s-sub">of {sessions.length} sessions support scanning</div>
        </div>
      </div>

      {scanning && rows.length === 0 && (
        <div className="empty-state">
          <div className="es-ico"><Icon name="shield" size={26} /></div>
          <div className="es-title">Scanning…</div>
          <div>Checking each scannable session for leaked credentials.</div>
        </div>
      )}

      {!scanning && rows.length === 0 && (
        <div className="empty-state">
          <div className="es-ico" style={{ color: 'var(--accent)' }}><Icon name="check" size={26} /></div>
          <div className="es-title">No secrets detected</div>
          <div>The scanner found nothing suspicious in any of your sessions.</div>
        </div>
      )}

      {rows.map(({ session, findings }) => (
        <div key={session.id} style={{ marginBottom: 22 }}>
          <div className="panel-head" style={{ marginBottom: 10 }}>
            <div className="panel-title" style={{ fontSize: 14 }}>
              <span style={{ cursor: 'pointer' }} onClick={() => onOpen(session.id)}>{session.name ?? session.preview}</span>
              <span className="pg-meta">· {session.project}</span>
              <ToolBadge tool={session.tool} />
            </div>
            <span className="panel-link" onClick={() => onOpen(session.id)}>
              Open session <Icon name="chevron" size={12} />
            </span>
          </div>
          {findings.map((f, i) => (
            <div className={clsx('sec-finding', f.severity)} key={i} style={{ '--sv': sevColor(f.severity) } as React.CSSProperties}>
              <span className="sec-ico"><Icon name="key" size={17} /></span>
              <div style={{ minWidth: 0 }}>
                <div className="sec-label">
                  {f.label ?? f.type}
                  <span className="tag" style={{ marginLeft: 6 }}>{f.type}</span>
                </div>
                <div className="sec-ctx"><span className="red">{f.pattern}</span> · {f.context}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="sec-line">L{f.lineNumber}</span>
                <SevPill sev={f.severity} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
