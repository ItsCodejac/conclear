import { useEffect, useState } from 'react';
import { Icon } from '../lib/icons';
import { clsx } from '../lib/format';
import { Btn } from '../components/Btn';
import { StatusToggle } from '../components/StatusToggle';

interface Props {
  toast: (type: 'success' | 'error', msg: string) => void;
  /** Navigate to the Upgrade / Pro & Teams page. */
  onGoto?: () => void;
}

const STORAGE_KEY = 'conclear.settings';

interface UISettings {
  autoBackup: boolean;
  scanOnLoad: boolean;
  resizeTargetKb: 256 | 512 | 1024;
  accent: 'Signal Lime' | 'Ultra Violet' | 'Vermilion' | 'Cyan';
  density: 'compact' | 'regular' | 'comfy';
  font: 'sans' | 'mono';
  radius: number;
}

const DEFAULTS: UISettings = {
  autoBackup: true, scanOnLoad: true, resizeTargetKb: 512,
  accent: 'Signal Lime', density: 'regular', font: 'sans', radius: 13,
};

const ACCENTS = {
  'Signal Lime':  { accent: '#cbf24e', accent2: '#b6e23a', on: '#0c1402' },
  'Ultra Violet': { accent: '#a78bfa', accent2: '#8b5cf6', on: '#120726' },
  'Vermilion':    { accent: '#ff6a3d', accent2: '#f0522a', on: '#1f0a03' },
  'Cyan':         { accent: '#38e0d4', accent2: '#18c7bb', on: '#04231f' },
} as const;

function hexRgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function applyTheme(s: UISettings): void {
  const root = document.documentElement;
  const a = ACCENTS[s.accent];
  root.style.setProperty('--accent', a.accent);
  root.style.setProperty('--accent-2', a.accent2);
  root.style.setProperty('--on-accent', a.on);
  root.style.setProperty('--accent-dim', hexRgba(a.accent, 0.12));
  root.style.setProperty('--accent-glow', hexRgba(a.accent, 0.30));
  root.style.setProperty('--r', s.radius + 'px');
  root.style.setProperty('--r-sm', Math.max(4, s.radius - 5) + 'px');
  root.style.setProperty('--r-xs', Math.max(3, s.radius - 7) + 'px');
  root.setAttribute('data-density', s.density);
  root.setAttribute('data-font', s.font);
}

function loadSettings(): UISettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULTS;
}

// Apply once on module load so the theme is right on first paint
applyTheme(loadSettings());

export function Settings({ toast, onGoto }: Props) {
  const [s, setS] = useState<UISettings>(loadSettings);

  useEffect(() => {
    applyTheme(s);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }, [s]);

  function update<K extends keyof UISettings>(key: K, value: UISettings[K]) {
    setS(prev => ({ ...prev, [key]: value }));
  }

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">ConClear reads session files directly from disk. Nothing leaves your machine.</p>
        </div>
      </div>

      {/* Behavior */}
      <div className="card panel" style={{ marginBottom: 'var(--gap)' }}>
        <div className="set-row">
          <div>
            <div className="set-label">ConClear Pro &amp; Teams</div>
            <div className="set-sub">AI-powered session summaries, native desktop app, team governance. Coming soon.</div>
          </div>
          {onGoto && (
            <Btn icon="bolt" variant="outline" onClick={onGoto}>Learn more</Btn>
          )}
        </div>
      </div>

      {/* Behavior */}
      <div className="card panel" style={{ marginBottom: 'var(--gap)' }}>
        <div className="set-row">
          <div>
            <div className="set-label">Backup before every operation</div>
            <div className="set-sub">Strip & resize write a timestamped restore point to <span className="mono" style={{ fontSize: 11 }}>~/.conclear/backups</span> first.</div>
          </div>
          <StatusToggle on={s.autoBackup} label={s.autoBackup ? 'on' : 'off'} onClick={() => update('autoBackup', !s.autoBackup)} />
        </div>
        <div className="divider" />
        <div className="set-row">
          <div>
            <div className="set-label">Scan for secrets on session load</div>
            <div className="set-sub">Flag pasted keys, tokens and env dumps automatically.</div>
          </div>
          <StatusToggle on={s.scanOnLoad} label={s.scanOnLoad ? 'on' : 'off'} onClick={() => update('scanOnLoad', !s.scanOnLoad)} />
        </div>
        <div className="divider" />
        <div className="set-row">
          <div>
            <div className="set-label">Default resize target</div>
            <div className="set-sub">Target file size when shrinking oversized images.</div>
          </div>
          <div className="seg">
            {[256, 512, 1024].map(v => (
              <span key={v} className={clsx('seg-opt', s.resizeTargetKb === v && 'on')} onClick={() => update('resizeTargetKb', v as 256 | 512 | 1024)}>
                {v < 1024 ? `${v}KB` : '1MB'}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Appearance */}
      <div className="card panel" style={{ marginBottom: 'var(--gap)' }}>
        <div className="set-row">
          <div>
            <div className="set-label">Accent color</div>
            <div className="set-sub">Used for the brand, primary actions, and the reclaim meter.</div>
          </div>
          <div className="seg">
            {(Object.keys(ACCENTS) as Array<keyof typeof ACCENTS>).map(k => (
              <span
                key={k}
                className={clsx('seg-opt', s.accent === k && 'on')}
                onClick={() => update('accent', k)}
                title={k}
                style={{ background: s.accent === k ? ACCENTS[k].accent : undefined, color: s.accent === k ? ACCENTS[k].on : undefined }}
              >
                {k.split(' ')[0]}
              </span>
            ))}
          </div>
        </div>
        <div className="divider" />
        <div className="set-row">
          <div>
            <div className="set-label">Density</div>
            <div className="set-sub">Row height + padding throughout the app.</div>
          </div>
          <div className="seg">
            {(['compact', 'regular', 'comfy'] as const).map(d => (
              <span key={d} className={clsx('seg-opt', s.density === d && 'on')} onClick={() => update('density', d)}>{d}</span>
            ))}
          </div>
        </div>
        <div className="divider" />
        <div className="set-row">
          <div>
            <div className="set-label">UI font</div>
            <div className="set-sub">Sans for chrome, mono for terminal-style emphasis.</div>
          </div>
          <div className="seg">
            {(['sans', 'mono'] as const).map(f => (
              <span key={f} className={clsx('seg-opt', s.font === f && 'on')} onClick={() => update('font', f)}>{f}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Danger zone */}
      <div className="card panel" style={{ borderColor: 'color-mix(in srgb, var(--danger) 30%, var(--line))' }}>
        <div className="panel-title" style={{ color: 'var(--danger)', marginBottom: 12 }}>
          <Icon name="warn" size={15} /> Danger zone
        </div>
        <div className="set-row">
          <div>
            <div className="set-label">Rebuild session cache</div>
            <div className="set-sub">Force a full re-parse of every tool's session directory.</div>
          </div>
          <Btn icon="refresh" variant="outline" onClick={() => { void fetch('/api/sessions?refresh=true').then(() => toast('success', 'Cache cleared — rescanning')); }}>
            Rebuild
          </Btn>
        </div>
        <div className="divider" />
        <div className="set-row">
          <div>
            <div className="set-label">Reset to defaults</div>
            <div className="set-sub">Restore the original accent, density, font, and behavior settings.</div>
          </div>
          <Btn variant="outline" danger onClick={() => { setS(DEFAULTS); toast('success', 'Settings reset to defaults'); }}>Reset</Btn>
        </div>
      </div>
    </div>
  );
}
