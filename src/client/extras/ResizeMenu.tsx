import { useEffect, useRef, useState } from 'react';
import { Btn } from '../components/Btn';
import { Icon } from '../lib/icons';

interface Props {
  onPick: (bytes: number) => void;
  label?: string;
  variant?: 'ghost' | 'primary' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  icon?: Parameters<typeof Icon>[0]['name'];
}

const OPTS = [
  { kb: 256,  label: '256 KB', note: 'aggressive' },
  { kb: 512,  label: '512 KB', note: 'recommended' },
  { kb: 1024, label: '1 MB',   note: 'light touch' },
];

export function ResizeMenu({ onPick, label = 'Resize', variant = 'ghost', size = 'sm', icon = 'resize' }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <span className="resize-wrap" ref={ref}>
      <Btn icon={icon} variant={variant} size={size} onClick={() => setOpen(o => !o)}>{label}</Btn>
      {open && (
        <div className="resize-pop">
          <div className="rp-title">Target file size</div>
          {OPTS.map(o => (
            <div className="rp-opt" key={o.kb} onClick={() => { onPick(o.kb * 1024); setOpen(false); }}>
              <span className="rp-kb">{o.label}</span>
              <span className="rp-note">{o.note}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
