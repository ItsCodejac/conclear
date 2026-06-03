import { Icon } from '../lib/icons';
import { clsx } from '../lib/format';
import { Btn } from '../components/Btn';
import { PLANS } from '../data/plans';

interface Props {
  /** Navigate back to settings (or wherever) when the user dismisses */
  onBack?: () => void;
}

export function Upgrade({ onBack }: Props) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">ConClear Pro &amp; Teams</h1>
          <p className="page-sub">
            You're on <b>Free</b> — the open-source CLI + web UI. Pro adds AI-powered features and native desktop polish.
            Teams adds shared governance for a whole team.
            {' '}<b style={{ color: 'var(--accent)' }}>Session content always stays on each machine.</b>
          </p>
        </div>
        {onBack && (
          <div className="page-actions">
            <Btn icon="close" variant="ghost" size="sm" onClick={onBack}>Back to Settings</Btn>
          </div>
        )}
      </div>

      <div className="pricing-grid">
        {PLANS.map(p => (
          <div className={clsx('plan-card', p.popular && 'popular', `t-${p.tier}`)} key={p.tier}>
            {p.popular && <div className="plan-badge">Coming soon</div>}
            <div className="plan-name">{p.name}</div>
            <div className="plan-price">
              {p.price === 0
                ? <span className="pp-num">$0</span>
                : p.price == null
                  ? <span className="pp-num">TBD</span>
                  : <span className="pp-num">${p.price}</span>}
              <span className="pp-unit">{p.unit}</span>
            </div>
            <div className="plan-tag">{p.tagline}</div>
            <div className="plan-feats">
              {p.features.map(f => (
                <div className="plan-feat" key={f}>
                  <Icon name="check" size={14} /> {f}
                </div>
              ))}
            </div>
            {p.tier === 'free'
              ? <Btn variant="outline" size="lg">Current plan</Btn>
              : p.tier === 'pro'
                ? <Btn variant="primary" size="lg" icon="bolt" onClick={() => window.open('https://github.com/ItsCodejac/conclear', '_blank')}>Notify me</Btn>
                : <Btn variant="outline" size="lg" onClick={() => window.open('https://github.com/ItsCodejac/conclear', '_blank')}>Notify me</Btn>}
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
