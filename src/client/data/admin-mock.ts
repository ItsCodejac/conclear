/**
 * Admin/Teams/Enterprise mock data. These surfaces require a sync service
 * + linked-agent that doesn't exist yet — see docs/admin-feasibility.md.
 *
 * The Admin page shows these to demo the surface; a banner makes clear
 * none of it is wired to a real backend.
 */

const hr = 3600e3, min = 60e3, day = 86400e3;
const NOW = Date.now();

export interface Workspace { id: string; name: string; plan: 'free' | 'teams' | 'enterprise'; initial: string; sub: string }
export interface Member { id: string; name: string; email: string; role: 'Owner' | 'Admin' | 'Member'; machine: string; version: string; lastSync: number | null; mcp: boolean; secretsOpen: number; spend: number; sessions: number }
export interface OrgLeak { id: string; member: string; project: string; type: string; label: string; severity: 'high' | 'medium' | 'low'; status: 'open' | 'acknowledged' | 'resolved'; age: number }
export interface Policy { id: string; label: string; desc: string; enabled: boolean; enforce: boolean; tier: 'teams' | 'enterprise'; icon: string; value?: string }
export interface AuditEntry { ts: number; actor: string; action: string; target: string; kind: string }
export interface Plan { tier: 'free' | 'teams' | 'enterprise'; name: string; price: number | null; unit: string; tagline: string; features: string[]; popular?: boolean }

export const WORKSPACES: Workspace[] = [
  { id: 'personal', name: 'Personal', plan: 'free', initial: '~', sub: 'This machine only' },
  { id: 'acme', name: 'Acme Robotics', plan: 'teams', initial: 'A', sub: '14 seats · Teams' },
  { id: 'globex', name: 'Globex', plan: 'enterprise', initial: 'G', sub: 'SSO · Enterprise' },
];

export const MEMBERS: Member[] = [
  { id: 'u1', name: 'Jordan Cole', email: 'jordan@acme.dev', role: 'Owner',  machine: 'jordan-mbp', version: '0.4.1', lastSync: NOW - 4 * min,  mcp: true,  secretsOpen: 0, spend: 41.2, sessions: 38 },
  { id: 'u2', name: 'Priya Nair',  email: 'priya@acme.dev',  role: 'Admin',  machine: 'priya-ws',   version: '0.4.1', lastSync: NOW - 22 * min, mcp: true,  secretsOpen: 3, spend: 63.8, sessions: 51 },
  { id: 'u3', name: 'Marcus Webb', email: 'marcus@acme.dev', role: 'Member', machine: 'mwebb-air',  version: '0.4.0', lastSync: NOW - 2 * hr,   mcp: true,  secretsOpen: 5, spend: 88.4, sessions: 72 },
  { id: 'u4', name: 'Lena Fischer',email: 'lena@acme.dev',   role: 'Member', machine: 'lena-mbp',   version: '0.4.1', lastSync: NOW - 1 * day,  mcp: true,  secretsOpen: 1, spend: 22.6, sessions: 24 },
  { id: 'u5', name: 'Diego Ramos', email: 'diego@acme.dev',  role: 'Member', machine: 'dramos-linux', version: '0.3.8', lastSync: NOW - 3 * day, mcp: false, secretsOpen: 2, spend: 17.1, sessions: 19 },
  { id: 'u6', name: 'Sara Kim',    email: 'sara@acme.dev',   role: 'Member', machine: 'skim-mbp',   version: '0.4.1', lastSync: NOW - 6 * hr,   mcp: true,  secretsOpen: 0, spend: 34.9, sessions: 40 },
  { id: 'u7', name: 'Tom Alvarez', email: 'tom@acme.dev',    role: 'Member', machine: '—',           version: '—',     lastSync: null,            mcp: false, secretsOpen: 0, spend: 0,    sessions: 0 },
];

export const ORG_LEAKS: OrgLeak[] = [
  { id: 'l1',  member: 'Marcus Webb',  project: 'hunt3r',              type: 'aws_key',      label: 'AWS access key id',   severity: 'high',   status: 'open',         age: NOW - 6 * hr },
  { id: 'l2',  member: 'Marcus Webb',  project: 'hunt3r',              type: 'private_key',  label: 'RSA private key block', severity: 'high', status: 'open',         age: NOW - 6 * hr },
  { id: 'l3',  member: 'Priya Nair',   project: 'Polymarket-Patcher',  type: 'api_key',      label: 'Stripe live key',     severity: 'high',   status: 'open',         age: NOW - 1 * day },
  { id: 'l4',  member: 'Priya Nair',   project: 'mog-locker',          type: 'bearer_token', label: 'GitHub token',        severity: 'medium', status: 'acknowledged', age: NOW - 2 * day },
  { id: 'l5',  member: 'Marcus Webb',  project: 'VEESTY',              type: 'env_file',     label: '.env contents pasted',severity: 'high',   status: 'open',         age: NOW - 9 * hr },
  { id: 'l6',  member: 'Diego Ramos',  project: 'ccxl',                type: 'api_key',      label: 'OpenAI key',          severity: 'medium', status: 'open',         age: NOW - 5 * hr },
  { id: 'l7',  member: 'Lena Fischer', project: 'dgent',               type: 'bearer_token', label: 'Slack webhook',       severity: 'low',    status: 'resolved',     age: NOW - 4 * day },
  { id: 'l8',  member: 'Priya Nair',   project: 'hunt3r',              type: 'env_file',     label: 'DB connection string',severity: 'medium', status: 'open',         age: NOW - 30 * min },
];

export const POLICIES: Policy[] = [
  { id: 'p1', label: 'Auto-redact detected secrets',          desc: 'Strip keys, tokens & env dumps from session files the moment they are written.', enabled: true,  enforce: true,  tier: 'teams',      icon: 'key' },
  { id: 'p2', label: 'Block sessions with high-severity leaks', desc: 'Quarantine a session until the owner redacts any high-severity secret.',         enabled: true,  enforce: false, tier: 'teams',      icon: 'shield' },
  { id: 'p3', label: 'Auto-resize images over 2000px',        desc: 'Shrink oversized screenshots to a 512 KB target to avoid dimension errors.',        enabled: true,  enforce: true,  tier: 'teams',      icon: 'resize' },
  { id: 'p4', label: 'Session retention limit',                desc: 'Automatically archive sessions inactive for more than 90 days.',                  enabled: false, enforce: false, tier: 'teams',      icon: 'archive', value: '90 days' },
  { id: 'p5', label: 'Require ConClear MCP on all clients',    desc: 'Members must have the MCP server installed to access org projects.',              enabled: true,  enforce: true,  tier: 'enterprise', icon: 'cpu' },
  { id: 'p6', label: 'Data residency & self-hosted sync',      desc: 'Keep all metadata sync within your own infrastructure.',                           enabled: false, enforce: false, tier: 'enterprise', icon: 'shield' },
];

export const AUDIT: AuditEntry[] = [
  { ts: NOW - 8 * min,  actor: 'Priya Nair',  action: 'redacted',         target: '3 secrets · Polymarket-Patcher',         kind: 'key' },
  { ts: NOW - 34 * min, actor: 'System',      action: 'enforced policy',  target: 'Auto-resize images · marcus-air',         kind: 'resize' },
  { ts: NOW - 2 * hr,   actor: 'Jordan Cole', action: 'invited member',   target: 'tom@acme.dev',                            kind: 'user' },
  { ts: NOW - 5 * hr,   actor: 'System',      action: 'detected leak',    target: 'AWS key · hunt3r · Marcus Webb',          kind: 'warn' },
  { ts: NOW - 1 * day,  actor: 'Priya Nair',  action: 'changed policy',   target: 'Block high-severity leaks → on',          kind: 'shield' },
  { ts: NOW - 1 * day,  actor: 'Jordan Cole', action: 'exported',         target: 'SOC2 audit log (Q2)',                     kind: 'download' },
  { ts: NOW - 2 * day,  actor: 'Diego Ramos', action: 'installed MCP',    target: 'Cursor · dramos-linux',                   kind: 'cpu' },
];

export const PLANS: Plan[] = [
  { tier: 'free',       name: 'Free',       price: 0,    unit: 'forever',      tagline: 'For individuals cleaning their own machine.',
    features: ['Local session browser & cleanup', 'Image strip / resize', 'Secret scanning (local)', 'MCP server + 11-client install', 'File history & diffs'] },
  { tier: 'teams',      name: 'Teams',      price: 12,   unit: 'per seat / mo', tagline: 'Shared governance for a whole team.', popular: true,
    features: ['Everything in Free', 'Org-wide secret-leak dashboard', 'Enforced cleanup & retention policies', 'Fleet rollout & install status', 'Aggregated usage & cost', 'Audit log'] },
  { tier: 'enterprise', name: 'Enterprise', price: null, unit: 'custom',        tagline: 'Compliance, scale & control.',
    features: ['Everything in Teams', 'SSO / SAML + SCIM', 'Self-hosted metadata sync', 'Data residency controls', 'SOC2 / GDPR evidence export', 'Priority SLA & support'] },
];

const openLeaks = ORG_LEAKS.filter(l => l.status === 'open').length;
const highLeaks = ORG_LEAKS.filter(l => l.severity === 'high' && l.status !== 'resolved').length;
const totalSpend = MEMBERS.reduce((s, m) => s + m.spend, 0);
const installed = MEMBERS.filter(m => m.mcp).length;
const activeMembers = MEMBERS.filter(m => m.lastSync).length;

export const ADMIN_STATS = {
  openLeaks, highLeaks, totalSpend, installed, activeMembers,
  seats: { used: activeMembers, total: 14 },
};
