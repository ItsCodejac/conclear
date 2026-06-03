import { useState } from 'react';
import { Icon, EVENT_META } from '../../lib/icons';
import { clsx } from '../../lib/format';
import type { Session } from '../../lib/types';
import { useConversation } from '../../hooks/useSessionDetail';
import { DetailBlock } from '../../extras/DiffBlock';
import { EmptyTab } from './EmptyTab';

interface Props { session: Session }

export function TimelineTab({ session }: Props) {
  const conv = useConversation(session.id);
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());

  if (conv.loading) return <EmptyTab icon="timeline" title="Loading timeline…" sub="Reading session events." />;
  const events = conv.data?.timeline ?? [];
  if (events.length === 0) return <EmptyTab icon="timeline" title="No timeline" sub="No structured events were parsed from this session." />;

  const allTypes = [...new Set(events.map(e => e.type))];
  const shown = types.size ? events.filter(e => types.has(e.type)) : events;

  function toggleType(t: string) {
    setTypes(prev => {
      const n = new Set(prev);
      n.has(t) ? n.delete(t) : n.add(t);
      return n;
    });
  }
  function toggleRow(id: string) {
    setOpen(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  return (
    <div>
      <div className="tl-filters">
        {allTypes.map(t => (
          <span key={t} className={clsx('chip', types.has(t) && 'on')} onClick={() => toggleType(t)}>
            <Icon name={EVENT_META[t]?.icon ?? 'dot'} size={12} /> {t}
          </span>
        ))}
      </div>
      <div className="tl">
        {shown.map(e => {
          const meta = EVENT_META[e.type] ?? { icon: 'dot' as const, tone: 'neutral' as const };
          const isOpen = open.has(e.id);
          return (
            <div key={e.id}>
              <div
                className={clsx('tl-row', e.detail && 'expandable')}
                onClick={e.detail ? () => toggleRow(e.id) : undefined}
              >
                <span className="tl-time">{e.timestamp}</span>
                <div className="tl-node">
                  <span className={clsx('tl-ico', meta.tone)}>
                    <Icon name={meta.icon} size={14} />
                  </span>
                </div>
                <span className="tl-summary">
                  <span className="tl-type">{e.type}</span>{e.summary}
                </span>
                <span className="tl-extra">
                  {e.durationMs != null && <span>{(e.durationMs / 1000).toFixed(1)}s</span>}
                  {e.exitCode != null && <span className={e.exitCode === 0 ? 'exit-ok' : 'exit-bad'}>exit {e.exitCode}</span>}
                  {e.detail && (
                    <Icon name="chevron" size={13} className={clsx('tl-chev', isOpen && 'open')} />
                  )}
                </span>
              </div>
              {e.detail && isOpen && (
                <div className="tl-detail">
                  {/* The backend currently sends detail as a plain string; treat as output. */}
                  <DetailBlock kind="output" text={typeof e.detail === 'string' ? e.detail : ''} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
