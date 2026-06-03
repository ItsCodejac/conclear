import { useEffect, useState } from 'react';
import { Icon } from '../lib/icons';
import { Logo } from '../lib/Logo';
import { clsx } from '../lib/format';

export function ScanOverlay({ onDone }: { onDone: () => void }) {
  const tools = ['Claude Code', 'Cursor', 'Gemini CLI', 'Cline / Roo', 'Copilot Chat'];
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (step >= tools.length) {
      const t = setTimeout(onDone, 280);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStep(s => s + 1), 230);
    return () => clearTimeout(t);
  }, [step, tools.length, onDone]);

  return (
    <div className="overlay scan-ov">
      <div className="scan-box">
        <div className="scan-logo"><Logo size={40} /></div>
        <div className="scan-title display">Scanning session data…</div>
        <div className="scan-list">
          {tools.map((t, i) => (
            <div className={clsx('scan-row', i < step && 'done', i === step && 'active')} key={t}>
              <span className="scan-ico">
                {i < step
                  ? <Icon name="check" size={14} />
                  : i === step
                    ? <span className="spinner" />
                    : <span className="scan-dot" />}
              </span>
              <span>{t}</span>
              {i < step && <span className="scan-stat mono">ok</span>}
            </div>
          ))}
        </div>
        <div className="scan-track"><div className="scan-fill" style={{ width: `${(step / tools.length) * 100}%` }} /></div>
      </div>
    </div>
  );
}
