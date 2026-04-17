import { useState, useEffect, useCallback } from 'react';
import type { SessionDetail, SessionImage } from '../../types';
import { ResizeMenu } from '../ResizeMenu';
import * as CtxMenu from '../ContextMenu';
import styles from './styles.module.css';

interface ImagePreviewProps {
  detail: SessionDetail;
  loading: boolean;
  onStrip: (imageIds?: string[]) => void;
  onRecover: (imageId: string) => void;
  onResize: (targetBytes: number, imageIds?: string[]) => void;
  strippedIds: Set<string>;
  disabled?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StrippedPlaceholder({ size }: { size: number }) {
  return (
    <div className={styles.placeholder}>
      <span className={styles.placeholderLabel}>CC</span>
      <span className={styles.placeholderSize}>{formatBytes(size)} freed</span>
    </div>
  );
}

function Lightbox({ src, image, onClose, onStrip }: {
  src: string;
  image: SessionImage;
  onClose: () => void;
  onStrip: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className={styles.lightboxOverlay} onClick={onClose}>
      <div className={styles.lightboxContent} onClick={e => e.stopPropagation()}>
        <img src={src} alt={image.context} className={styles.lightboxImage} />
        <div className={styles.lightboxMeta}>
          <span className={styles.lightboxContext}>{image.context}</span>
          <span className={styles.lightboxSize}>{formatBytes(image.sizeBytes)}</span>
          {image.timestamp && (
            <span className={styles.lightboxTimestamp}>
              {new Date(image.timestamp).toLocaleString()}
            </span>
          )}
          <button className={styles.lightboxStrip} onClick={onStrip}>
            Strip this image
          </button>
        </div>
        <button className={styles.lightboxClose} onClick={onClose}>ESC</button>
      </div>
    </div>
  );
}

function ImageThumb({ sessionId, image, onStrip, stripped }: {
  sessionId: string;
  image: SessionImage;
  onStrip: () => void;
  stripped: boolean;
}) {
  const [state, setState] = useState<'thumb' | 'expanded' | 'lightbox'>('thumb');
  const src = `/api/sessions/${sessionId}/images/${encodeURIComponent(image.id)}`;

  if (stripped) {
    return <StrippedPlaceholder size={image.sizeBytes} />;
  }

  const handleClick = () => {
    if (state === 'thumb') setState('expanded');
    else if (state === 'expanded') setState('lightbox');
  };

  return (
    <>
      <div className={styles.thumbContainer} onClick={handleClick}>
        <img
          src={src}
          alt={image.context}
          className={state === 'expanded' ? styles.thumbExpanded : styles.thumb}
          loading="lazy"
        />
      </div>
      {state === 'lightbox' && (
        <Lightbox
          src={src}
          image={image}
          onClose={() => setState('expanded')}
          onStrip={() => { onStrip(); setState('thumb'); }}
        />
      )}
    </>
  );
}

export function ImagePreview({ detail, loading, onStrip, onRecover, onResize, strippedIds, disabled }: ImagePreviewProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reset selection when detail changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [detail.id]);

  const activeImages = detail.images.filter(img => !strippedIds.has(img.id));
  const strippedImages = detail.images.filter(img => strippedIds.has(img.id));

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    const activeIds = activeImages.map(img => img.id);
    const allSelected = activeIds.length > 0 && activeIds.every(id => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(activeIds));
    }
  }, [activeImages, selectedIds]);

  const selectedCount = [...selectedIds].filter(id => !strippedIds.has(id)).length;
  const allActiveSelected = activeImages.length > 0 && activeImages.every(img => selectedIds.has(img.id));

  const handleStripSelected = useCallback(() => {
    const ids = [...selectedIds].filter(id => !strippedIds.has(id));
    if (ids.length > 0) {
      onStrip(ids);
      setSelectedIds(new Set());
    }
  }, [selectedIds, strippedIds, onStrip]);

  const handleResizeSelected = useCallback((targetBytes: number) => {
    const ids = [...selectedIds].filter(id => !strippedIds.has(id));
    if (ids.length > 0) {
      onResize(targetBytes, ids);
      setSelectedIds(new Set());
    }
  }, [selectedIds, strippedIds, onResize]);

  if (loading) return <div className={styles.loading}>Loading detail...</div>;

  return (
    <div className={styles.panel}>
      <div className={styles.heading}>Session Detail</div>

      <div className={styles.stat}>
        <span className={styles.statLabel}>Total size</span>
        <span>{formatBytes(detail.totalSizeBytes)}</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.statLabel}>Image data</span>
        <span>{formatBytes(detail.imageSizeBytes)}</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.statLabel}>Messages</span>
        <span>{detail.messageCount}</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.statLabel}>Tool results</span>
        <span>{formatBytes(detail.toolResultSizeBytes)}</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.statLabel}>Path</span>
        <span title={detail.filePath} style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {detail.filePath.split('/').slice(-2).join('/')}
        </span>
      </div>

      <hr className={styles.divider} />

      <div className={styles.heading}>
        Images ({activeImages.length})
        {activeImages.length > 0 && (
          <span className={styles.reclaimable}>
            {formatBytes(detail.imageSizeBytes)} reclaimable
          </span>
        )}
      </div>

      {strippedImages.length > 0 && (
        <div className={styles.strippedBanner}>
          {strippedImages.length} stripped — {formatBytes(
            strippedImages.reduce((s, img) => s + img.sizeBytes, 0)
          )} freed
        </div>
      )}

      {selectedCount > 0 && (
        <div className={styles.selectionToolbar}>
          <span className={styles.selectionCount}>{selectedCount} selected</span>
          <button
            className={styles.stripBtn}
            onClick={handleStripSelected}
          >
            Strip Selected ({selectedCount})
          </button>
          <ResizeMenu
            onResize={handleResizeSelected}
            compact
            label="Resize Selected"
          />
          <button
            className={styles.selectionClear}
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      {detail.images.length === 0 ? (
        <div className={styles.noImages}>Clean -- no images</div>
      ) : (
        <ul className={styles.imageList}>
          <li className={styles.selectAllRow}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={allActiveSelected}
                onChange={toggleSelectAll}
              />
              <span className={styles.selectAllText}>
                {allActiveSelected ? 'Deselect all' : 'Select all'}
              </span>
            </label>
          </li>
          {detail.images.map(img => {
            const isStripped = strippedIds.has(img.id);
            const isSelected = selectedIds.has(img.id);
            return (
              <CtxMenu.Root key={img.id}>
                <CtxMenu.Trigger asChild>
                  <li className={isStripped ? styles.imageItemStripped : styles.imageItem}>
                    {!isStripped && (
                      <input
                        type="checkbox"
                        className={styles.checkbox}
                        checked={isSelected}
                        onChange={() => toggleSelect(img.id)}
                      />
                    )}
                    <ImageThumb
                      sessionId={detail.id}
                      image={img}
                      onStrip={() => onStrip([img.id])}
                      stripped={isStripped}
                    />
                    <div className={styles.imageMeta}>
                      <span className={styles.imageContext}>{img.context}</span>
                      <span className={isStripped ? styles.imageSizeStripped : styles.imageSize}>
                        {formatBytes(img.sizeBytes)}
                      </span>
                    </div>
                    {isStripped ? (
                      <button
                        className={styles.recoverBtn}
                        onClick={() => onRecover(img.id)}
                        title="Recover this image"
                      >
                        recover
                      </button>
                    ) : (
                      <div className={styles.actionGroup}>
                        <ResizeMenu
                          onResize={(bytes) => onResize(bytes, [img.id])}
                          compact
                          label="resize"
                        />
                        <button
                          className={styles.stripBtn}
                          onClick={() => onStrip([img.id])}
                          title="Strip this image"
                        >
                          strip
                        </button>
                      </div>
                    )}
                  </li>
                </CtxMenu.Trigger>
                <CtxMenu.Content>
                  {isStripped ? (
                    <CtxMenu.Item onSelect={() => onRecover(img.id)}>
                      Recover
                    </CtxMenu.Item>
                  ) : (
                    <>
                      <CtxMenu.Item danger onSelect={() => onStrip([img.id])}>
                        Strip
                      </CtxMenu.Item>
                      <CtxMenu.ResizeSubmenu
                        onResize={(bytes) => onResize(bytes, [img.id])}
                      />
                      <CtxMenu.Separator />
                      <CtxMenu.Item onSelect={() => {
                        // Find and click through to lightbox state
                        const thumbs = document.querySelectorAll(`.${styles.thumbContainer}`);
                        const imgIndex = detail.images.findIndex(i => i.id === img.id);
                        const thumb = thumbs[imgIndex];
                        if (thumb instanceof HTMLElement) {
                          thumb.click();
                          // Need two clicks to get to lightbox (thumb -> expanded -> lightbox)
                          requestAnimationFrame(() => {
                            if (thumb instanceof HTMLElement) thumb.click();
                          });
                        }
                      }}>
                        Open in Lightbox
                      </CtxMenu.Item>
                    </>
                  )}
                </CtxMenu.Content>
              </CtxMenu.Root>
            );
          })}
        </ul>
      )}
    </div>
  );
}
