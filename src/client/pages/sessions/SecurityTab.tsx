import { Icon } from '../../lib/icons';
import { clsx, sevColor } from '../../lib/format';
import type { Session } from '../../lib/types';
import { Btn } from '../../components/Btn';
import { SevPill } from '../../components/SevPill';
import { useCachedScan, redactSession } from '../../hooks/useScanCache';
import { rotationFor } from '../../lib/rotate';
import { EmptyTab } from './EmptyTab';

interface Props {
  session: Session;
  toast: (type: 'success' | 'error', msg: string) => void;
}

export function SecurityTab({ session, toast }: Props) {
  const scan = useCachedScan(session.id);

  if (scan.loading && scan.findings == null) {
    return <EmptyTab icon="shield" title="Scanning…" sub="Looking for pasted keys, tokens, and env dumps." />;
  }
  const findings = scan.findings ?? [];

  if (findings.length === 0) {
    return (
      <div className="empty-state">
        <div className="es-ico" style={{ color: 'var(--accent)' }}><Icon name="shield" size={26} /></div>
        <div className="es-title">No secrets detected</div>
        <div>The scanner found no keys, tokens or env dumps in this session.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="img-actionbar" style={{ marginBottom: 16 }}>
        <span className="ab-stat">
          <b style={{ color: 'var(--danger)' }}>{findings.length}</b> secrets found — these are stored in plaintext in the session file.
        </span>
        <span style={{ flex: 1 }} />
        <Btn icon="scissors" variant="primary" size="sm" onClick={async () => {
          const r = await redactSession(session.id, null);
          if (r.ok) toast('success', `Redacted ${r.replaced} secret${r.replaced === 1 ? '' : 's'} — backup written`);
          else toast('error', r.error ?? 'Redact failed');
        }}>
          Redact all
        </Btn>
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
              onClick={async () => {
                const r = await redactSession(session.id, { lineNumber: f.lineNumber });
                if (r.ok) toast('success', `Redacted ${r.replaced} secret${r.replaced === 1 ? '' : 's'} — backup written`);
                else toast('error', r.error ?? 'Redact failed');
              }} />
          </div>
        </div>
      ))}
    </div>
  );
}
