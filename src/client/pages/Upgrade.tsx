import { Icon } from '../lib/icons';
import { clsx } from '../lib/format';
import { Btn } from '../components/Btn';
import { PLANS, WORKSPACES, type Workspace } from '../data/admin-mock';

export function Upgrade({ onSwitch }: { onSwitch: (w: Workspace) => void }) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Unlock Teams</h1>
          <p className="page-sub">
            You're on <b>Free</b> — everything local, just for this machine. Upgrade to govern secrets, policies and cost across your whole team.
            {' '}<b style={{ color: 'var(--accent)' }}>Session content always stays on each machine.</b>
          </p>
        </div>
      </div>

      <div className="pricing-grid">
        {PLANS.map(p => (
          <div className={clsx('plan-card', p.popular && 'popular', `t-${p.tier}`)} key={p.tier}>
            {p.popular && <div className="plan-badge">Most popular</div>}
            <div className="plan-name">{p.name}</div>
            <div className="plan-price">
              {p.price === 0
                ? <span className="pp-num">$0</span>
                : p.price == null
                  ? <span className="pp-num">Custom</span>
                  : <span className="pp-num">${p.price}</span>}
              <span className="pp-unit">{p.unit}</span>
            </div>
            <div className="plan-tag">{p.tagline}</div>
            <div className="plan-feats">
              {p.features.map(f => <div className="plan-feat" key={f}><Icon name="check" size={14} /> {f}</div>)}
            </div>
            {p.tier === 'free'
              ? <Btn variant="outline" size="lg">Current plan</Btn>
              : p.tier === 'teams'
                ? <Btn variant="primary" size="lg" icon="bolt" onClick={() => onSwitch(WORKSPACES.find(w => w.plan === 'teams')!)}>Start Teams trial</Btn>
                : <Btn variant="outline" size="lg" onClick={() => onSwitch(WORKSPACES.find(w => w.plan === 'enterprise')!)}>Contact sales</Btn>}
          </div>
        ))}
      </div>

      <div className="card panel" style={{ marginTop: 'var(--gap)' }}>
        <div className="panel-title" style={{ marginBottom: 6 }}>
          <Icon name="shield" size={15} className="pt-ico" /> What syncs, and what doesn't
        </div>
        <p className="page-sub" style={{ margin: 0 }}>
          Teams shares only <b>metadata</b> — leak findings, install status, usage totals. Your actual conversations, code and screenshots never leave the machine they're on. Admins see <i>that</i> a secret leaked and where, never the secret itself.
        </p>
      </div>
    </div>
  );
}
