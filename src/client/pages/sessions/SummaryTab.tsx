import { Icon } from '../../lib/icons';
import { fmtBytes, fmtNum, relTime } from '../../lib/format';
import { type Session, type ToolCaps } from '../../lib/types';
import { SegBar } from '../../components/SegBar';
import { useConversation, useFileHistory } from '../../hooks/useSessionDetail';

interface Props {
  session: Session & { toolResultSizeBytes?: number; textSizeBytes?: number };
  caps: ToolCaps;
  onTab: (tab: string) => void;
}

export function SummaryTab({ session, caps, onTab }: Props) {
  const conv = useConversation(session.id);
  const files = useFileHistory(session.id);

  const keyMsgs = (conv.data?.messages ?? [])
    .filter(m => m.role === 'user' && m.text.length > 12)
    .map(m => m.text)
    .slice(0, 5);
  const filesTouched = (files.data ?? []).map(f => f.filePath);

  const comp = [
    { label: 'Images',       value: session.imageSizeBytes,             color: 'var(--accent)',     note: 'cleanable' },
    { label: 'Tool results', value: session.toolResultSizeBytes ?? 0,   color: 'var(--warn)',       note: 'context bloat' },
    { label: 'Text',         value: session.textSizeBytes ?? 0,         color: 'var(--surface-3)',  note: 'conversation' },
  ];
  const imgPct = session.totalSizeBytes > 0 ? (session.imageSizeBytes / session.totalSizeBytes) * 100 : 0;

  return (
    <div>
      {/* composition */}
      <div className="card panel" style={{ marginBottom: 'var(--gap)' }}>
        <div className="panel-head">
          <div className="panel-title"><Icon name="grid" size={15} className="pt-ico" /> What's taking space</div>
          <span className="pg-meta">{fmtBytes(session.totalSizeBytes)} total</span>
        </div>
        <SegBar h={11} segments={comp.map(c => ({ value: c.value, color: c.color, label: c.label }))} />
        <div className="bloat-legend">
          {comp.map(c => (
            <span className="bloat-leg" key={c.label}>
              <span className="sw" style={{ background: c.color }} /> {c.label} <b>{fmtBytes(c.value)}</b>
            </span>
          ))}
        </div>
        <div className="divider" />
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
          {imgPct > 40
            ? <>This session is <b style={{ color: 'var(--accent)' }}>{imgPct.toFixed(0)}% images</b> — stripping or resizing them reclaims the most space.{' '}
                {caps.resize && <span className="panel-link" onClick={() => onTab('images')} style={{ display: 'inline' }}>Open images →</span>}</>
            : <>Most of this session is <b style={{ color: 'var(--warn)' }}>tool-result bloat</b>, not images — image cleanup won't shrink it much. Consider archiving or resuming fresh.</>}
        </div>
      </div>

      {/* stats */}
      <div className="summary-grid">
        <div className="card sum-stat"><div className="ss-label">Messages</div><div className="ss-val">{session.messageCount}</div></div>
        <div className="card sum-stat"><div className="ss-label">Files touched</div><div className="ss-val">{filesTouched.length || '—'}</div></div>
        {session.usage?.totalCostUsd != null
          ? <>
              <div className="card sum-stat"><div className="ss-label">Est. cost</div><div className="ss-val reclaim-num">${session.usage.totalCostUsd.toFixed(2)}</div></div>
              <div className="card sum-stat">
                <div className="ss-label">Tokens</div>
                <div className="ss-val" style={{ fontSize: 19 }}>
                  {fmtNum(session.usage.tokensIn ?? 0)} <span style={{ color: 'var(--muted2)', fontSize: 13 }}>in</span> ·{' '}
                  {fmtNum(session.usage.tokensOut ?? 0)} <span style={{ color: 'var(--muted2)', fontSize: 13 }}>out</span>
                </div>
              </div>
            </>
          : <>
              <div className="card sum-stat"><div className="ss-label">Images</div><div className="ss-val">{session.imageCount}</div></div>
              <div className="card sum-stat"><div className="ss-label">Last active</div><div className="ss-val" style={{ fontSize: 18 }}>{relTime(session.lastActiveAt)}</div></div>
            </>}
      </div>

      {/* key messages */}
      {keyMsgs.length > 0 && (
        <div className="card panel" style={{ marginBottom: 'var(--gap)' }}>
          <div className="panel-title" style={{ marginBottom: 10 }}>
            <Icon name="chat" size={15} className="pt-ico" /> Key user messages
          </div>
          {keyMsgs.map((m, i) => (
            <div className="sum-keymsg" key={i}>
              <span className="km-q">{i + 1}</span>
              <span className="km-text">{m}</span>
            </div>
          ))}
        </div>
      )}

      {/* files touched */}
      {filesTouched.length > 0 && (
        <div className="card panel">
          <div className="panel-head">
            <div className="panel-title"><Icon name="file" size={15} className="pt-ico" /> Files touched</div>
            {caps.fileHistory && (
              <span className="panel-link" onClick={() => onTab('files')}>
                Version history <Icon name="chevron" size={12} />
              </span>
            )}
          </div>
          <div className="sum-files">
            {filesTouched.map(f => <span className="sum-file" key={f}>{f}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
