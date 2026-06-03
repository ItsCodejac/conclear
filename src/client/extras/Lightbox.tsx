import { useEffect } from 'react';
import { Btn } from '../components/Btn';
import { Icon } from '../lib/icons';
import { fmtBytes } from '../lib/format';
import { ResizeMenu } from './ResizeMenu';

export interface LBImage {
  id: string;
  width: number;
  height: number;
  sizeBytes: number;
  mediaType: string;
  context: string;
  oversized: boolean;
  hue: number;
}

interface Props {
  /** Session ID the images belong to — used to build the API URL for the lightbox source. */
  sessionId: string;
  images: LBImage[];
  index: number;
  strippedIds: Set<string>;
  caps: { resize: boolean };
  onIndex: (i: number) => void;
  onClose: () => void;
  onStrip: (ids: string[]) => void;
  onResize: (id: string, bytes: number) => void;
  onRecover: (id: string) => void;
}

export function thumbStyle(hue: number): React.CSSProperties {
  return { background: `linear-gradient(135deg, hsl(${hue} 45% 32%), hsl(${(hue + 40) % 360} 50% 20%))` };
}

export function Lightbox({ sessionId, images, index, strippedIds, caps, onIndex, onClose, onStrip, onResize, onRecover }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onIndex(Math.min(index + 1, images.length - 1));
      if (e.key === 'ArrowLeft') onIndex(Math.max(index - 1, 0));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, images.length, onClose, onIndex]);

  const img = images[index];
  if (!img) return null;
  const isStripped = strippedIds.has(img.id);

  return (
    <div className="overlay lightbox-ov" onClick={onClose}>
      <div className="lightbox" onClick={e => e.stopPropagation()}>
        <div className="lb-stage">
          {index > 0 && (
            <button className="lb-nav left" onClick={() => onIndex(index - 1)}>
              <Icon name="chevron" size={22} style={{ transform: 'rotate(180deg)' }} />
            </button>
          )}
          <div className="lb-image" style={isStripped ? undefined : { background: '#0a0c0b' }}>
            {isStripped
              ? <div className="lb-stripped"><Icon name="check" size={26} /><span>Stripped — replaced with placeholder</span></div>
              : <>
                  <img
                    src={`/api/sessions/${encodeURIComponent(sessionId)}/images/${encodeURIComponent(img.id)}`}
                    alt={img.context}
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  />
                  <span className="lb-dim mono">{img.width} × {img.height}</span>
                </>}
          </div>
          {index < images.length - 1 && (
            <button className="lb-nav right" onClick={() => onIndex(index + 1)}>
              <Icon name="chevron" size={22} />
            </button>
          )}
        </div>
        <div className="lb-bar">
          <div className="lb-meta">
            <div className="lb-ctx">{img.context}</div>
            <div className="lb-sub mono">
              {img.mediaType} · {fmtBytes(img.sizeBytes)} · {img.width}×{img.height}
              {img.oversized && <span style={{ color: 'var(--warn)' }}> · oversized</span>}
            </div>
          </div>
          <div className="lb-actions">
            <span className="lb-count mono">{index + 1} / {images.length}</span>
            {isStripped
              ? <Btn icon="restore" variant="outline" size="md" onClick={() => onRecover(img.id)}>Recover</Btn>
              : <>
                  {caps.resize && <ResizeMenu size="md" variant="outline" onPick={b => onResize(img.id, b)} />}
                  <Btn icon="scissors" variant="primary" size="md" onClick={() => onStrip([img.id])}>Strip</Btn>
                </>}
            <Btn icon="close" variant="ghost" size="md" onClick={onClose} />
          </div>
        </div>
      </div>
    </div>
  );
}
