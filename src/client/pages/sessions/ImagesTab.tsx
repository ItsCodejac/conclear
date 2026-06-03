import { useEffect, useState } from 'react';
import { Icon } from '../../lib/icons';
import { fmtBytes } from '../../lib/format';
import { clsx } from '../../lib/format';
import type { Session, SessionDetail, ToolCaps, SessionImage } from '../../lib/types';
import { Btn } from '../../components/Btn';
import { ResizeMenu } from '../../extras/ResizeMenu';
import { Lightbox, thumbStyle, type LBImage } from '../../extras/Lightbox';
import { EmptyTab } from './EmptyTab';

interface Props {
  session: Session;
  caps: ToolCaps;
  toast: (type: 'success' | 'error', msg: string) => void;
}

function useImages(sessionId: string) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
        if (res.ok && !cancelled) setDetail(await res.json());
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);
  return detail?.images ?? null;
}

function enrich(img: SessionImage, idx: number): LBImage {
  // Backend doesn't currently send width/height in the list endpoint, only the
  // detail's image array. We make best-effort guesses for the UI accent.
  const oversized = false; // session.hasOversizedImages flags at the session level
  return {
    id: img.id,
    width: 1280,
    height: 800,
    sizeBytes: img.sizeBytes,
    mediaType: img.mediaType,
    context: img.context,
    oversized,
    hue: (idx * 47) % 360,
  };
}

export function ImagesTab({ session, caps, toast }: Props) {
  const apiImages = useImages(session.id);
  const [stripped, setStripped] = useState<Set<string>>(new Set());
  const [lb, setLb] = useState<number | null>(null);

  if (apiImages == null) return <EmptyTab icon="image" title="Loading images…" sub="Reading the session for image inventory." />;
  if (apiImages.length === 0) return <EmptyTab icon="image" title="No images" sub="This session has no stored screenshots." />;

  const imgs = apiImages.map(enrich);
  const liveBytes = imgs.filter(i => !stripped.has(i.id)).reduce((s, i) => s + i.sizeBytes, 0);
  const overCount = imgs.filter(i => i.oversized).length;

  async function strip(ids: string[]) {
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(session.id)}/strip`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageIds: ids }),
      });
      if (!res.ok) throw new Error('strip failed');
      const result = await res.json() as { bytesReclaimed?: number };
      setStripped(prev => { const n = new Set(prev); ids.forEach(i => n.add(i)); return n; });
      toast('success', `Stripped ${ids.length} image${ids.length > 1 ? 's' : ''} · ${fmtBytes(result.bytesReclaimed ?? 0)} freed`);
    } catch (err) {
      toast('error', `Strip failed: ${err}`);
    }
  }
  function recover(id: string) {
    setStripped(prev => { const n = new Set(prev); n.delete(id); return n; });
    toast('success', 'Image recovered');
  }
  function resizeOne(id: string, bytes: number) {
    void fetch(`/api/sessions/${encodeURIComponent(session.id)}/resize`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageIds: [id], targetBytes: bytes }),
    }).then(r => r.ok
      ? toast('success', `Resized to ${fmtBytes(bytes)} target`)
      : toast('error', 'Resize failed'));
  }

  return (
    <div>
      <div className="img-actionbar">
        <span className="ab-stat">
          <b>{imgs.length}</b> images · <b className="sz">{fmtBytes(liveBytes)}</b> live
          {overCount > 0 && <> · <span style={{ color: 'var(--warn)' }}>{overCount} oversized</span></>}
        </span>
        <span style={{ flex: 1 }} />
        {caps.resize
          ? <ResizeMenu label="Resize all" variant="outline" onPick={b => {
              void fetch(`/api/sessions/${encodeURIComponent(session.id)}/resize`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetBytes: b }),
              }).then(r => r.ok ? toast('success', `Resized all to ${fmtBytes(b)} target`) : toast('error', 'Resize failed'));
            }} />
          : <Btn icon="resize" variant="ghost" size="sm" disabled title="Tool can't resize">Resize n/a</Btn>}
        <Btn icon="scissors" variant="primary" size="sm" onClick={() => void strip(imgs.map(i => i.id))}>Strip all</Btn>
      </div>

      <div className="img-grid">
        {imgs.map((img, idx) => {
          const isStripped = stripped.has(img.id);
          return (
            <div key={img.id} className={clsx('imgcard', isStripped && 'stripped', img.oversized && 'oversized')}>
              <div className="imgthumb" onClick={() => setLb(idx)}>
                {isStripped
                  ? <div className="ph" style={thumbStyle(img.hue)} />
                  : <img
                      className="ph"
                      src={`/api/sessions/${encodeURIComponent(session.id)}/images/${encodeURIComponent(img.id)}`}
                      alt={img.context}
                      loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={(e) => { (e.currentTarget.style.display = 'none'); }}
                    />}
                <span className="dim-badge">{img.width}×{img.height}</span>
                {img.oversized && (
                  <span className="over-badge" title="exceeds 2000px">
                    <Icon name="warn" size={13} />
                  </span>
                )}
                {isStripped && (
                  <span className="strip-mark"><Icon name="check" size={14} /> stripped</span>
                )}
              </div>
              <div className="imgmeta">
                <div className="imgmeta-top">
                  <span className="ictx">{img.context}</span>
                  <span className="isize sz">{fmtBytes(img.sizeBytes)}</span>
                </div>
                <div className="imgcard-actions">
                  {isStripped
                    ? <Btn icon="restore" variant="outline" size="sm" onClick={() => recover(img.id)}>Recover</Btn>
                    : <>
                        {caps.resize && <ResizeMenu label="" variant="ghost" icon="resize" onPick={b => resizeOne(img.id, b)} />}
                        <Btn icon="scissors" variant="ghost" size="sm" onClick={() => void strip([img.id])}>Strip</Btn>
                      </>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {lb !== null && (
        <Lightbox
          sessionId={session.id}
          images={imgs}
          index={lb}
          strippedIds={stripped}
          caps={caps}
          onIndex={setLb}
          onClose={() => setLb(null)}
          onStrip={ids => void strip(ids)}
          onResize={resizeOne}
          onRecover={recover}
        />
      )}
    </div>
  );
}
