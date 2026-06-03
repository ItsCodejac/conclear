/**
 * Admin tables and policy/audit sections grouped together to keep file count down.
 * Each export below is one admin sub-section.
 */
import { useState } from 'react';
import { Icon } from '../../lib/icons';
import { clsx, relTime, sevColor } from '../../lib/format';
import { Btn } from '../../components/Btn';
import { SevPill } from '../../components/SevPill';
import { StatusToggle } from '../../components/StatusToggle';
import { Meter } from '../../components/Meter';
import { ORG_LEAKS, MEMBERS, POLICIES, AUDIT, ADMIN_STATS, PLANS, type Workspace } from '../../data/admin-mock';

type Toast = (type: 'success' | 'error', msg: string) => void;

/* ── Leaks ───────────────────────────────────────────────────────────────── */
export function AdminLeaks({ toast }: { toast: Toast }) {
  const [status, setStatus] = useState<'open' | 'acknowledged' | 'resolved' | 'all'>('open');
  const [items, setItems] = useState(ORG_LEAKS);
  const shown = items.filter(l => status === 'all' || l.status === status);
  function act(id: string, to: 'acknowledged' | 'resolved') {
    setItems(items.map(l => l.id === id ? { ...l, status: to } : l));
    toast('success', to === 'resolved' ? 'Leak marked resolved' : 'Leak acknowledged');
  }
  const counts = {
    open: items.filter(l => l.status === 'open').length,
    acknowledged: items.filter(l => l.status === 'acknowledged').length,
    resolved: items.filter(l => l.status === 'resolved').length,
    all: items.length,
  };

  return (
    <div>
      <div className="flex items-center gap-2" style={{ marginBottom: 14, justifyContent: 'space-between' }}>
        <div className="flex gap-2">
          {(['open', 'acknowledged', 'resolved', 'all'] as const).map(s => (
            <span key={s} className={clsx('chip', status === s && 'on')} onClick={() => setStatus(s)} style={{ textTransform: 'capitalize' }}>
              {s} <span className="c-count">{counts[s]}</span>
            </span>
          ))}
        </div>
        <Btn icon="download" variant="ghost" size="sm" onClick={() => toast('success', 'Exported leak report (CSV)')}>Export</Btn>
      </div>
      <div className="adt">
        <div className="adt-head adt-leak">
          <span>Finding</span><span>Member</span><span>Project</span><span>Age</span><span>Severity</span><span />
        </div>
        {shown.map(l => (
          <div className="adt-row adt-leak" key={l.id}>
            <span className="adt-c1">
              <span className="sec-ico sm" style={{ '--sv': sevColor(l.severity) } as React.CSSProperties}>
                <Icon name="key" size={13} />
              </span>
              <span><div className="adt-name">{l.label}</div><div className="adt-sub mono">{l.type}</div></span>
            </span>
            <span className="adt-mut">{l.member}</span>
            <span className="adt-mut">{l.project}</span>
            <span className="adt-mut mono">{relTime(l.age)}</span>
            <span><SevPill sev={l.severity} /></span>
            <span className="adt-actions">
              {l.status === 'resolved'
                ? <span className="status-tag" style={{ color: 'var(--accent)' }}><Icon name="check" size={12} /> resolved</span>
                : <>
                    {l.status === 'open' && <Btn variant="ghost" size="sm" onClick={() => act(l.id, 'acknowledged')}>Ack</Btn>}
                    <Btn variant="outline" size="sm" icon="check" onClick={() => act(l.id, 'resolved')}>Resolve</Btn>
                  </>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Policies ────────────────────────────────────────────────────────────── */
export function AdminPolicies({ workspace, toast }: { workspace: Workspace; toast: Toast }) {
  const [pol, setPol] = useState(POLICIES);
  function toggle(id: string, key: 'enabled' | 'enforce') {
    setPol(pol.map(p => p.id === id ? { ...p, [key]: !p[key] } : p));
    toast('success', 'Policy updated & pushed to fleet');
  }
  return (
    <div>
      <p className="page-sub" style={{ marginTop: 0, marginBottom: 16 }}>
        Enabled policies run on every member's machine. Enforced ones can't be turned off locally.
      </p>
      <div className="policy-grid">
        {pol.map(p => {
          const locked = p.tier === 'enterprise' && workspace.plan !== 'enterprise';
          return (
            <div className={clsx('card policy-card', locked && 'locked')} key={p.id}>
              <div className="policy-top">
                <span className="policy-ico"><Icon name={p.icon as any} size={17} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="policy-label">
                    {p.label}
                    {p.tier === 'enterprise' && <span className="ent-tag">Enterprise</span>}
                    {p.value && <span className="tag" style={{ marginLeft: 6 }}>{p.value}</span>}
                  </div>
                  <div className="policy-desc">{p.desc}</div>
                </div>
              </div>
              {locked
                ? <div className="policy-locked"><Icon name="shield" size={13} /> Available on Enterprise</div>
                : <div className="policy-actions">
                    <StatusToggle on={p.enabled} label={p.enabled ? 'Enabled' : 'Disabled'} onClick={() => toggle(p.id, 'enabled')} />
                    <StatusToggle on={p.enforce} label="Enforce" onClick={() => toggle(p.id, 'enforce')} disabled={!p.enabled} />
                  </div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Fleet ───────────────────────────────────────────────────────────────── */
export function AdminFleet({ toast }: { toast: Toast }) {
  return (
    <div>
      <div className="flex items-center gap-2" style={{ marginBottom: 14, justifyContent: 'space-between' }}>
        <span className="page-sub" style={{ margin: 0 }}>
          {MEMBERS.filter(m => m.mcp).length} of {MEMBERS.filter(m => m.lastSync).length} machines have the MCP server installed.
        </span>
        <Btn icon="bolt" variant="primary" size="sm" onClick={() => toast('success', 'Sent install command to 2 machines')}>Push to all</Btn>
      </div>
      <div className="adt">
        <div className="adt-head adt-fleet">
          <span>Member</span><span>Machine</span><span>Version</span><span>MCP</span><span>Last sync</span><span />
        </div>
        {MEMBERS.map(m => (
          <div className="adt-row adt-fleet" key={m.id}>
            <span className="adt-c1">
              <span className="avatar-sm">{m.name.slice(0, 1)}</span>
              <span className="adt-name">{m.name}</span>
            </span>
            <span className="adt-mut mono">{m.machine}</span>
            <span className="adt-mut mono">{m.version}</span>
            <span>
              {m.mcp
                ? <span className="status-tag" style={{ color: 'var(--accent)' }}><span className="live-dot live" /> on</span>
                : <span className="status-tag" style={{ color: 'var(--muted2)' }}>off</span>}
            </span>
            <span className="adt-mut mono">{m.lastSync ? relTime(m.lastSync) : 'never'}</span>
            <span className="adt-actions">
              {!m.mcp && m.lastSync && (
                <Btn variant="outline" size="sm" icon="download" onClick={() => toast('success', `Install pushed to ${m.machine}`)}>Install</Btn>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Members ─────────────────────────────────────────────────────────────── */
export function AdminMembers({ toast }: { toast: Toast }) {
  return (
    <div>
      <div className="flex items-center gap-2" style={{ marginBottom: 14, justifyContent: 'space-between' }}>
        <span className="page-sub" style={{ margin: 0 }}>{ADMIN_STATS.seats.used} of {ADMIN_STATS.seats.total} seats used</span>
        <Btn icon="user" variant="primary" size="sm" onClick={() => toast('success', 'Invite sent')}>Invite member</Btn>
      </div>
      <div className="adt">
        <div className="adt-head adt-mem">
          <span>Member</span><span>Role</span><span>Sessions</span><span>Open leaks</span><span>Spend</span><span />
        </div>
        {MEMBERS.map(m => (
          <div className="adt-row adt-mem" key={m.id}>
            <span className="adt-c1">
              <span className="avatar-sm">{m.name.slice(0, 1)}</span>
              <span><div className="adt-name">{m.name}</div><div className="adt-sub">{m.email}</div></span>
            </span>
            <span><span className={clsx('role-tag', m.role.toLowerCase())}>{m.role}</span></span>
            <span className="adt-mut mono">{m.sessions || '—'}</span>
            <span className="adt-mut">{m.secretsOpen > 0 ? <span style={{ color: 'var(--danger)' }}>{m.secretsOpen}</span> : '0'}</span>
            <span className="adt-mut mono">${m.spend.toFixed(0)}</span>
            <span className="adt-actions">
              {m.lastSync
                ? <Btn variant="ghost" size="sm" icon="gear" onClick={() => toast('success', 'Member settings')} />
                : <span className="status-tag" style={{ color: 'var(--warn)' }}>pending</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Usage ───────────────────────────────────────────────────────────────── */
export function AdminUsage() {
  const sorted = [...MEMBERS].filter(m => m.spend > 0).sort((a, b) => b.spend - a.spend);
  const max = sorted[0]?.spend ?? 1;
  return (
    <div>
      <div className="grid-3" style={{ marginBottom: 'var(--gap)' }}>
        <div className="card statcard">
          <div className="s-label"><Icon name="coin" size={14} /> Total spend</div>
          <div className="s-val reclaim-num">${ADMIN_STATS.totalSpend.toFixed(0)}</div>
          <div className="s-sub">this month</div>
        </div>
        <div className="card statcard">
          <div className="s-label"><Icon name="user" size={14} /> Avg / member</div>
          <div className="s-val">${(ADMIN_STATS.totalSpend / ADMIN_STATS.activeMembers).toFixed(0)}</div>
          <div className="s-sub">{ADMIN_STATS.activeMembers} active</div>
        </div>
        <div className="card statcard">
          <div className="s-label"><Icon name="sparkle" size={14} /> Top spender</div>
          <div className="s-val" style={{ fontSize: 22 }}>{sorted[0]?.name.split(' ')[0]}</div>
          <div className="s-sub">${sorted[0]?.spend.toFixed(0)} this month</div>
        </div>
      </div>
      <div className="card panel">
        <div className="panel-title" style={{ marginBottom: 14 }}>
          <Icon name="coin" size={15} className="pt-ico" /> Spend by member
        </div>
        <div className="olist">
          {sorted.map(m => (
            <div className="barrow" key={m.id}>
              <span className="barrow-label">{m.name}</span>
              <Meter value={m.spend} max={max} color="var(--accent)" />
              <span className="barrow-meta">${m.spend.toFixed(0)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Audit ───────────────────────────────────────────────────────────────── */
export function AdminAudit({ toast }: { toast: Toast }) {
  return (
    <div>
      <div className="flex items-center gap-2" style={{ marginBottom: 14, justifyContent: 'space-between' }}>
        <span className="page-sub" style={{ margin: 0 }}>
          Immutable record of every governance action. Exportable for SOC2 / GDPR evidence.
        </span>
        <div className="flex gap-2">
          <Btn icon="download" variant="ghost" size="sm" onClick={() => toast('success', 'Exported audit log (CSV)')}>CSV</Btn>
          <Btn icon="download" variant="outline" size="sm" onClick={() => toast('success', 'Generated SOC2 evidence pack')}>SOC2 pack</Btn>
        </div>
      </div>
      <div className="card panel">
        <div className="audit-list big">
          {AUDIT.map((a, i) => (
            <div className="audit-row" key={i}>
              <span className="audit-ico"><Icon name={a.kind as any} size={14} /></span>
              <span className="audit-text"><b>{a.actor}</b> {a.action} <span className="audit-target">{a.target}</span></span>
              <span className="audit-time">{relTime(a.ts)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Billing ─────────────────────────────────────────────────────────────── */
export function AdminBilling({ workspace, toast }: { workspace: Workspace; toast: Toast }) {
  const current = workspace.plan;
  const plan = PLANS.find(p => p.tier === current)!;
  const monthly = current === 'teams' ? ADMIN_STATS.seats.total * 12 : null;
  return (
    <div>
      <div className="card panel" style={{ marginBottom: 'var(--gap)' }}>
        <div className="flex items-center" style={{ justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div className="s-label" style={{ color: 'var(--muted2)' }}>Current plan</div>
            <div className="flex items-center gap-2" style={{ marginTop: 6 }}>
              <span className="display" style={{ fontSize: 26, fontWeight: 700 }}>{plan.name}</span>
              <span className={clsx('plan-pill', `plan-${current}`)}>
                {current === 'enterprise' ? 'custom' : `$${plan.price}/seat`}
              </span>
            </div>
            <div className="page-sub" style={{ margin: '6px 0 0' }}>
              {ADMIN_STATS.seats.used} of {ADMIN_STATS.seats.total} seats used
              {monthly ? ` · $${monthly}/mo` : ' · billed annually'}
            </div>
          </div>
          <div className="flex gap-2">
            {current === 'teams' && (
              <Btn variant="outline" onClick={() => toast('success', 'Opening Enterprise contact form')}>Talk to sales</Btn>
            )}
            <Btn variant="ghost" onClick={() => toast('success', 'Manage seats')}>Manage seats</Btn>
            <Btn variant="primary" icon="coin" onClick={() => toast('success', 'Billing portal opened')}>Billing portal</Btn>
          </div>
        </div>
        <div className="divider" />
        <div className="flex items-center gap-2" style={{ justifyContent: 'space-between' }}>
          <span className="page-sub" style={{ margin: 0 }}>Seat usage</span>
          <span className="num" style={{ fontSize: 15 }}>{ADMIN_STATS.seats.used}/{ADMIN_STATS.seats.total}</span>
        </div>
        <div className="mt-2"><Meter value={ADMIN_STATS.seats.used} max={ADMIN_STATS.seats.total} color="var(--accent)" /></div>
      </div>
      <div className="pricing-grid compact">
        {PLANS.map(p => (
          <div className={clsx('plan-card', p.tier === current && 'current', `t-${p.tier}`)} key={p.tier}>
            {p.tier === current && <div className="plan-badge cur">Current</div>}
            <div className="plan-name">{p.name}</div>
            <div className="plan-price">
              {p.price === 0
                ? <span className="pp-num">$0</span>
                : p.price == null
                  ? <span className="pp-num">Custom</span>
                  : <span className="pp-num">${p.price}</span>}
              <span className="pp-unit">{p.unit}</span>
            </div>
            <div className="plan-feats">
              {p.features.slice(0, 5).map((f, i) => (
                <div className="plan-feat" key={i}><Icon name="check" size={13} /> {f}</div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
