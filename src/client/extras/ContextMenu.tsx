import { useEffect, useRef } from 'react';
import { Icon } from '../lib/icons';
import { clsx } from '../lib/format';

export interface ContextItem {
  label?: string;
  icon?: Parameters<typeof Icon>[0]['name'];
  hint?: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  sep?: boolean;
}

export function ContextMenu({ x, y, items, onClose }: {
  x: number; y: number; items: ContextItem[]; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const style = {
    left: Math.min(x, window.innerWidth - 230),
    top: Math.min(y, window.innerHeight - (items.length * 38 + 10)),
  };

  return (
    <div className="ctxmenu" ref={ref} style={style} onContextMenu={e => e.preventDefault()}>
      {items.map((it, i) =>
        it.sep
          ? <div className="ctx-sep" key={i} />
          : (
            <div
              key={i}
              className={clsx('ctx-item', it.danger && 'danger', it.disabled && 'dis')}
              onClick={() => {
                if (it.disabled) return;
                it.onClick?.();
                onClose();
              }}
            >
              {it.icon && <Icon name={it.icon} size={15} />}
              <span>{it.label}</span>
              {it.hint && <span className="ctx-hint">{it.hint}</span>}
            </div>
          )
      )}
    </div>
  );
}
