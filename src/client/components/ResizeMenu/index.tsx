import { useState } from 'react';
import styles from './styles.module.css';

const PRESETS = [
  { label: '50 KB', bytes: 50 * 1024 },
  { label: '100 KB', bytes: 100 * 1024 },
  { label: '200 KB', bytes: 200 * 1024 },
  { label: '500 KB', bytes: 500 * 1024 },
];

interface ResizeMenuProps {
  onResize: (targetBytes: number) => void;
  label?: string;
  compact?: boolean;
  disabled?: boolean;
}

export function ResizeMenu({ onResize, label, compact, disabled }: ResizeMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.container}>
      <button
        className={compact ? styles.btnCompact : styles.btn}
        onClick={() => setOpen(!open)}
        disabled={disabled}
      >
        {label ?? 'Resize'}
      </button>
      {open && (
        <div className={styles.menu}>
          {PRESETS.map(p => (
            <button
              key={p.bytes}
              className={styles.menuItem}
              onClick={() => { onResize(p.bytes); setOpen(false); }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
