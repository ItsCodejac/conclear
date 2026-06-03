import { useMemo } from 'react';
import { Icon } from '../../lib/icons';
import { relTime } from '../../lib/format';
import { Meter } from '../../components/Meter';
import { ADMIN_STATS, ORG_LEAKS, AUDIT, MEMBERS } from '../../data/admin-mock';

export function AdminOverview({ onGo }: { onGo: (sec: string) => void }) {
  const compliance = Math.round((MEMBERS.filter(m => m.mcp).length / MEMBERS.filter(m => m.lastSync).length) * 100);
  const topLeakers = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of ORG_LEAKS) if (l.status !== 'resolved') m.set(l.member, (m.get(l.member) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, []);

  return (
    <div>
      <div className="grid-3" style={{ marginBottom: 'var(--gap)' }}>
        <div className="card statcard dangerstat">
          <div className="s-label"><Icon name="key" size={14} /> Open leaks</div>
          <div className="s-val">{ADMIN_STATS.openLeaks}</div>
          <div className="s-sub">{ADMIN_STATS.highLeaks} high severity</div>
        </div>
        <div className="card statcard">
          <div className="s-label"><Icon name="user" size={14} /> Seats</div>
          <div className="s-val">{ADMIN_STATS.seats.used}<span style={{ fontSize: 16, color: 'var(--muted2)' }}>/{ADMIN_STATS.seats.total}</span></div>
          <div className="s-sub">{ADMIN_STATS.activeMembers} active members</div>
        </div>
        <div className="card statcard">
          <div className="s-label"><Icon name="coin" size={14} /> Monthly spend</div>
          <div className="s-val reclaim-num">${ADMIN_STATS.totalSpend.toFixed(0)}</div>
          <div className="s-sub">across the team</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card panel">
          <div className="panel-head">
            <div className="panel-title">
              <Icon name="key" size={15} className="pt-ico" style={{ color: 'var(--danger)' }} /> Members with open leaks
            </div>
            <span className="panel-link" onClick={() => onGo('leaks')}>All leaks <Icon name="chevron" size={12} /></span>
          </div>
          <div className="olist">
            {topLeakers.map(([name, n]) => (
              <div className="orow" key={name} onClick={() => onGo('leaks')}>
                <span className="orank"><Icon name="user" size={14} style={{ color: 'var(--muted2)' }} /></span>
                <span className="oname">{name}</span>
                <span className="odim" style={{ color: 'var(--danger)' }}>{n} open</span>
                <span className="ocount" />
              </div>
            ))}
          </div>
          <div className="divider" />
          <div className="flex items-center gap-2" style={{ justifyContent: 'space-between' }}>
            <span className="page-sub" style={{ margin: 0, whiteSpace: 'nowrap' }}>Policy compliance</span>
            <span className="num" style={{ fontSize: 16, color: compliance > 80 ? 'var(--accent)' : 'var(--warn)' }}>{compliance}%</span>
          </div>
          <div className="mt-2"><Meter value={compliance} max={100} color={compliance > 80 ? 'var(--accent)' : 'var(--warn)'} /></div>
        </div>

        <div className="card panel">
          <div className="panel-head">
            <div className="panel-title"><Icon name="list" size={15} className="pt-ico" /> Recent activity</div>
            <span className="panel-link" onClick={() => onGo('audit')}>Audit log <Icon name="chevron" size={12} /></span>
          </div>
          <div className="audit-list">
            {AUDIT.slice(0, 6).map((a, i) => (
              <div className="audit-row" key={i}>
                <span className="audit-ico"><Icon name={a.kind as any} size={13} /></span>
                <span className="audit-text"><b>{a.actor}</b> {a.action} <span className="audit-target">{a.target}</span></span>
                <span className="audit-time">{relTime(a.ts)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
