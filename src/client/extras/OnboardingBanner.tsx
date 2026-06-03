import { useEffect, useState } from 'react';
import { Icon } from '../lib/icons';
import { Btn } from '../components/Btn';

interface Props {
  onConnect: () => void;
}

const DISMISS_KEY = 'conclear.onboarding.dismissed.v1';

/**
 * First-run prompt that shows on Reclaim when ConClear isn't installed into
 * any AI client yet. The most valuable thing the app does (let your agents
 * query session history via MCP) is two clicks away — without this banner
 * it's invisible. Self-fetches install status so callers don't have to plumb
 * it through; cheap because the endpoint is fast and cached server-side.
 */
export function OnboardingBanner({ onConnect }: Props) {
  const [installed, setInstalled] = useState<number | null>(null);
  const [detected, setDetected] = useState(0);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');

  useEffect(() => {
    if (dismissed) return;
    void fetch('/api/install/status')
      .then(r => r.ok ? r.json() : [])
      .then((clients: Array<{ mcpInstalled: boolean; detected: boolean }>) => {
        setInstalled(clients.filter(c => c.mcpInstalled).length);
        setDetected(clients.filter(c => c.detected).length);
      })
      .catch(() => { /* ignore — banner just won't appear */ });
  }, [dismissed]);

  if (dismissed || installed == null || installed > 0) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  }

  return (
    <div className="onboard-banner">
      <span className="ob-ico"><Icon name="cpu" size={18} /></span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="ob-title">Connect ConClear to your AI clients</div>
        <div className="ob-sub">
          {detected > 0
            ? <>We detected <b>{detected}</b> compatible client{detected === 1 ? '' : 's'} on this machine. Wiring up ConClear's MCP lets your agents query session history, find lost chats, and recover files.</>
            : <>ConClear becomes most useful when installed into your AI clients (Claude Code, Cursor, Antigravity, etc). Agents can then query session history through MCP.</>}
        </div>
      </div>
      <Btn icon="bolt" variant="primary" size="sm" onClick={onConnect}>Open Connect</Btn>
      <Btn icon="close" variant="ghost" size="sm" title="Dismiss" onClick={dismiss} />
    </div>
  );
}
