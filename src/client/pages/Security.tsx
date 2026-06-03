import { useMemo } from 'react';
import { Icon } from '../lib/icons';
import { clsx, sevColor, decodeProject } from '../lib/format';
import { rotationFor } from '../lib/rotate';
import { TOOLS, type Session } from '../lib/types';
import { Btn } from '../components/Btn';
import { ToolBadge } from '../components/ToolBadge';
import { SevPill } from '../components/SevPill';
import type { useScanCache } from '../hooks/useScanCache';

interface Props {
  sessions: Session[];
  scan: ReturnType<typeof useScanCache>;
  onOpen: (id: string) => void;
  toast: (type: 'success' | 'error', msg: string) => void;
}

export function Security({ sessions, scan, onOpen, toast }: Props) {
  const sessionsById = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions]);
  const scannable = sessions.filter(s => TOOLS[s.tool].caps.scanSecrets).length;
  const scannedCount = Object.keys(scan.cache.results).length;

  const rows = useMemo(() => {
    return scan.sessionsWithFindings
      .map(id => ({
        session: sessionsById.get(id),
        findings: scan.cache.results[id] ?? [],
      }))
      .filter(r => r.session)
      .sort((a, b) => b.findings.length - a.findings.length) as Array<{ session: Session; findings: NonNullable<ReturnType<typeof scan.cache.results['']>> }>;
  }, [scan.sessionsWithFindings, scan.cache.results, sessionsById]);

  const total = scan.totalFindings;
  const high = scan.highSeverity;

  async function redactAll() {
    const targets = rows.map(r => r.session.id);
    if (targets.length === 0) return;
    let total = 0;
    let failed = 0;
    for (const id of targets) {
      const r = await scan.redact(id, null);
      if (r.ok) total += r.replaced; else failed++;
    }
    if (failed > 0) toast('error', `Redacted ${total} secrets · ${failed} session${failed === 1 ? '' : 's'} failed`);
    else toast('success', `Redacted ${total} secret${total === 1 ? '' : 's'} across ${targets.length} session${targets.length === 1 ? '' : 's'} — backups in ~/.conclear/backups`);
  }

  async function redactOne(id: string, lineNumber: number) {
    const r = await scan.redact(id, { lineNumber });
    if (r.ok) toast('success', `Redacted ${r.replaced} secret${r.replaced === 1 ? '' : 's'} — backup written`);
    else toast('error', r.error ?? 'Redact failed');
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Security</h1>
          <p className="page-sub">
            Secrets the scanner found pasted into session files — keys, tokens, env dumps.
            {scan.scanning && <> · <span style={{ color: 'var(--muted)' }}>scanning {scannedCount} / {scannable}…</span></>}
          </p>
        </div>
        <div className="page-actions">
          <Btn icon="refresh" variant="ghost" onClick={() => void scan.refresh(true)}>Rescan all</Btn>
          {total > 0 && (
            <Btn icon="scissors" variant="primary" danger onClick={redactAll}>
              Redact all
            </Btn>
          )}
        </div>
      </div>

      <div className="grid-3" style={{ marginBottom: 'var(--gap)' }}>
        <div className="card statcard dangerstat">
          <div className="s-label"><Icon name="key" size={14} /> Secrets found</div>
          <div className="s-val">{total}</div>
          <div className="s-sub">across {rows.length} session{rows.length === 1 ? '' : 's'}</div>
        </div>
        <div className="card statcard">
          <div className="s-label"><Icon name="warn" size={14} /> High severity</div>
          <div className="s-val" style={{ color: 'var(--danger)' }}>{high}</div>
          <div className="s-sub">act on these first</div>
        </div>
        <div className="card statcard">
          <div className="s-label"><Icon name="shield" size={14} /> Scanned</div>
          <div className="s-val reclaim-num">{scannedCount}<span style={{ fontSize: 18, color: 'var(--muted)' }}>/{scannable}</span></div>
          <div className="s-sub">{scannable} of {sessions.length} sessions support scanning</div>
        </div>
      </div>

      {scan.scanning && rows.length === 0 && (
        <div className="empty-state">
          <div className="es-ico"><Icon name="shield" size={26} /></div>
          <div className="es-title">Scanning…</div>
          <div>Checking each scannable session for leaked credentials.</div>
        </div>
      )}

      {!scan.scanning && scannedCount === scannable && rows.length === 0 && (
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
              <span className="pg-meta">· {decodeProject(session.project)}</span>
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
                {(() => {
                  const rot = rotationFor(f.type);
                  if (!rot) return null;
                  return rot.url
                    ? <a className="sec-rotate" href={rot.url} target="_blank" rel="noreferrer">
                        <Icon name="bolt" size={11} /> {rot.label}
                      </a>
                    : <div className="sec-rotate static"><Icon name="bolt" size={11} /> {rot.label}</div>;
                })()}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="sec-line">L{f.lineNumber}</span>
                <SevPill sev={f.severity} />
                <Btn icon="scissors" variant="ghost" size="sm" title="Redact this secret"
                  onClick={() => void redactOne(session.id, f.lineNumber)} />
                <Btn icon="chevron" variant="ghost" size="sm" title="Open in chat"
                  onClick={() => onOpen(session.id)} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
