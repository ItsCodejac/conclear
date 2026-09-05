import { useEffect, useState } from 'react';
import { Icon } from '../lib/icons';
import { Btn } from '../components/Btn';

const DISMISS_KEY = 'conclear.update.dismissed';

interface VersionInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
}

/**
 * Nudge shown when a newer conclear is on npm. Dismissal is remembered per
 * version, so the banner returns when the next release lands. An outdated
 * ConClear matters more than most tools — it means an outdated secret-pattern
 * table. The server caches the registry lookup for 24h and the check is off
 * entirely under CONCLEAR_NO_UPDATE_CHECK / CI.
 */
export function UpdateBanner() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState(() => localStorage.getItem(DISMISS_KEY));

  useEffect(() => {
    void fetch('/api/version')
      .then(r => r.ok ? r.json() : null)
      .then((v: VersionInfo | null) => { if (v) setInfo(v); })
      .catch(() => { /* ignore — banner just won't appear */ });
  }, []);

  if (!info?.updateAvailable || info.latest === dismissedVersion) return null;

  function dismiss() {
    if (info?.latest) localStorage.setItem(DISMISS_KEY, info.latest);
    setDismissedVersion(info?.latest ?? null);
  }

  return (
    <div className="onboard-banner">
      <span className="ob-ico"><Icon name="refresh" size={18} /></span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="ob-title">Update available: {info.current} → {info.latest}</div>
        <div className="ob-sub">
          Newer releases can detect and redact more credential types. Run <code>npm install -g conclear</code> and restart.
        </div>
      </div>
      <Btn icon="close" variant="ghost" size="sm" title="Dismiss until the next release" onClick={dismiss} />
    </div>
  );
}
