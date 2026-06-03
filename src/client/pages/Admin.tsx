import { useState } from 'react';
import { Icon } from '../lib/icons';
import { clsx } from '../lib/format';
import { type Workspace } from '../data/admin-mock';
import { AdminOverview } from './admin/AdminOverview';
import {
  AdminLeaks, AdminPolicies, AdminFleet, AdminMembers, AdminUsage, AdminAudit, AdminBilling,
} from './admin/AdminTables';

interface Props {
  workspace: Workspace;
  toast: (type: 'success' | 'error', msg: string) => void;
}

type Section = 'overview' | 'leaks' | 'policies' | 'fleet' | 'members' | 'usage' | 'audit' | 'billing';

interface NavSpec { id: Section; label: string; icon: Parameters<typeof Icon>[0]['name'] }
const NAV: NavSpec[] = [
  { id: 'overview', label: 'Overview', icon: 'grid' },
  { id: 'leaks',    label: 'Leaks',    icon: 'key' },
  { id: 'policies', label: 'Policies', icon: 'shield' },
  { id: 'fleet',    label: 'Fleet',    icon: 'cpu' },
  { id: 'members',  label: 'Members',  icon: 'user' },
  { id: 'usage',    label: 'Usage',    icon: 'coin' },
  { id: 'audit',    label: 'Audit',    icon: 'list' },
  { id: 'billing',  label: 'Billing',  icon: 'archive' },
];

// Build-dependency annotations (see docs/admin-feasibility.md)
const REQ: Record<Section, { lvl: string; label: string; text: string }> = {
  overview: { lvl: 'derived', label: 'Derived',              text: 'Rollups of metadata other sections sync — trivial once data flows.' },
  leaks:    { lvl: 'sync',    label: 'Needs sync',           text: 'Local scanner already exists; push finding metadata only. Secret values never leave the machine.' },
  policies: { lvl: 'agent',   label: 'Needs managed agent',  text: '"Enforce / can\'t disable locally" requires a persistent background agent that applies org config.' },
  fleet:    { lvl: 'agent',   label: 'Needs managed agent',  text: 'Status reporting = sync (easy). Remote "push install" = control channel (hardest item).' },
  members:  { lvl: 'saas',    label: 'Standard SaaS',         text: 'Accounts, roles, invites, seats.' },
  usage:    { lvl: 'tool',    label: 'Tool-dependent',        text: 'Only some adapters expose per-session cost today (Cline/Roo). Estimated otherwise.' },
  audit:    { lvl: 'sync',    label: 'Needs sync',            text: 'Append-only action log + auditor-friendly export (SOC2/GDPR pack).' },
  billing:  { lvl: 'saas',    label: 'Standard SaaS',         text: 'Billing provider + seat counting.' },
};

export function Admin({ workspace, toast }: Props) {
  const [sec, setSec] = useState<Section>('overview');
  const req = REQ[sec];

  return (
    <div className="page" style={{ maxWidth: 1180 }}>
      {/* Preview banner — this whole surface is mock until the sync layer ships */}
      <div className="admin-req req-tool" style={{ marginBottom: 18 }}>
        <span className="req-dot" />
        <span className="req-lvl">Preview</span>
        <span className="req-text">
          Teams / Enterprise are designed but not wired to a backend yet. The data below is illustrative.
        </span>
        <span className="req-doc mono">docs/admin-feasibility.md</span>
      </div>

      <div className="page-head">
        <div>
          <h1 className="page-title">Admin · {workspace.name}</h1>
          <p className="page-sub">Org-wide governance. Metadata only — session content stays on each member's machine.</p>
        </div>
        <div className="page-actions">
          <span className={clsx('plan-pill', `plan-${workspace.plan}`)}>
            {workspace.plan === 'enterprise' ? 'Enterprise' : 'Teams'} plan
          </span>
        </div>
      </div>

      <div className="admin-subnav">
        {NAV.map(n => (
          <span key={n.id} className={clsx('asub', sec === n.id && 'on')} onClick={() => setSec(n.id)}>
            <Icon name={n.icon} size={14} /> {n.label}
          </span>
        ))}
      </div>

      <div className={clsx('admin-req', `req-${req.lvl}`)} title="Build dependency — see docs/admin-feasibility.md">
        <span className="req-dot" />
        <span className="req-lvl">{req.label}</span>
        <span className="req-text">{req.text}</span>
        <span className="req-doc mono">docs/admin-feasibility.md</span>
      </div>

      {sec === 'overview' && <AdminOverview onGo={s => setSec(s as Section)} />}
      {sec === 'leaks'    && <AdminLeaks toast={toast} />}
      {sec === 'policies' && <AdminPolicies workspace={workspace} toast={toast} />}
      {sec === 'fleet'    && <AdminFleet toast={toast} />}
      {sec === 'members'  && <AdminMembers toast={toast} />}
      {sec === 'usage'    && <AdminUsage />}
      {sec === 'audit'    && <AdminAudit toast={toast} />}
      {sec === 'billing'  && <AdminBilling workspace={workspace} toast={toast} />}
    </div>
  );
}
