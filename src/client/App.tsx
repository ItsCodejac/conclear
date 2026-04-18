import { useState, useCallback, useRef } from 'react';
import { PaneLayout } from './components/PaneLayout';
import { SessionTable } from './components/SessionTable';
import { Toolbar } from './components/Toolbar';
import { ImagePreview } from './components/ImagePreview';
import { ConversationView } from './components/ConversationView';
import { TimelineView } from './components/TimelineView';
import { FilesView } from './components/FilesView';
import { BackupManager } from './components/BackupManager';
import { ScanResults } from './components/ScanResults';
import { HelpPanel } from './components/HelpPanel';
import { GlobalSearch } from './components/GlobalSearch';
import { DiskUsage } from './components/DiskUsage';
import { ConfirmDialog, type ConfirmDialogProps } from './components/ConfirmDialog';
import { ToastContainer, useToast } from './components/Toast';
import { useSessions } from './hooks/useSessions';
import { useKeyboard } from './hooks/useKeyboard';
import type { SessionDetail } from './types';
import styles from './App.module.css';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// In-memory cache of image data for recovery
interface CachedImage {
  base64: string;
  mediaType: string;
}

type PendingConfirm = Omit<ConfirmDialogProps, 'onConfirm' | 'onCancel'> & {
  action: () => void;
};

export function App() {
  const { sessions, loading, error, refresh } = useSessions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [strippedIds, setStrippedIds] = useState<Set<string>>(new Set());
  const [showBackups, setShowBackups] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [detailTab, setDetailTab] = useState<'images' | 'timeline' | 'chat' | 'files'>('images');
  const [operating, setOperating] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [toasts, toast] = useToast();
  const imageCache = useRef<Map<string, CachedImage>>(new Map());

  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const selectSession = useCallback(async (id: string) => {
    const isSame = id === selectedIdRef.current;
    setSelectedId(id);
    setDetailLoading(true);
    if (!isSame) {
      setStrippedIds(new Set());
      imageCache.current.clear();
    }
    try {
      const res = await fetch(`/api/sessions/${id}`);
      const data = await res.json();
      setDetail(data);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const cacheImage = useCallback(async (sessionId: string, imageId: string): Promise<CachedImage | null> => {
    const cached = imageCache.current.get(imageId);
    if (cached) return cached;

    try {
      const res = await fetch(`/api/sessions/${sessionId}/images/${encodeURIComponent(imageId)}`);
      if (!res.ok) return null;
      const blob = await res.blob();
      const mediaType = blob.type || 'image/png';
      const buffer = await blob.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      const entry = { base64, mediaType };
      imageCache.current.set(imageId, entry);
      return entry;
    } catch {
      return null;
    }
  }, []);

  const handleStrip = useCallback(async (imageIds?: string[]) => {
    if (!selectedId || !detail) return;
    if (operating) return;
    const ids = imageIds ?? detail.images.map(img => img.id);

    setOperating(`Stripping ${ids.length} image${ids.length > 1 ? 's' : ''}...`);

    try {
      // Cache all images before stripping
      await Promise.all(ids.map(id => cacheImage(selectedId, id)));

      const body = imageIds ? { imageIds } : {};
      const res = await fetch(`/api/sessions/${selectedId}/strip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await res.json();

      // Mark as stripped locally
      setStrippedIds(prev => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });

      // Update stats locally
      const strippedBytes = detail.images
        .filter(img => ids.includes(img.id))
        .reduce((sum, img) => sum + img.sizeBytes, 0);

      setDetail(prev => prev ? {
        ...prev,
        totalSizeBytes: prev.totalSizeBytes - (result.bytesReclaimed ?? strippedBytes),
        imageSizeBytes: prev.imageSizeBytes - strippedBytes,
      } : null);

      toast.success(`Stripped ${ids.length} image${ids.length > 1 ? 's' : ''} -- ${formatBytes(result.bytesReclaimed ?? strippedBytes)} freed`);
    } catch (err) {
      toast.error(`Strip failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setOperating(null);
    }
  }, [selectedId, detail, cacheImage, operating, toast]);

  const handleStripWithConfirm = useCallback((imageIds?: string[]) => {
    if (!detail) return;
    const ids = imageIds ?? detail.images.map(img => img.id);
    const isBulk = !imageIds; // "Strip All" -- no specific IDs passed

    if (isBulk && ids.length > 1) {
      const totalBytes = detail.images
        .filter(img => ids.includes(img.id))
        .reduce((sum, img) => sum + img.sizeBytes, 0);
      setConfirm({
        title: 'Strip all images',
        message: `This will strip ${ids.length} images (${formatBytes(totalBytes)}) from the session file. Originals will be cached in memory for recovery during this session.`,
        confirmLabel: `Strip ${ids.length} images`,
        action: () => handleStrip(),
      });
    } else {
      handleStrip(imageIds);
    }
  }, [detail, handleStrip]);

  const handleRecover = useCallback(async (imageId: string) => {
    if (!selectedId) return;
    if (operating) return;
    const cached = imageCache.current.get(imageId);
    if (!cached) {
      toast.error('Image data not in cache -- cannot recover');
      return;
    }

    setOperating('Recovering image...');

    try {
      await fetch(`/api/sessions/${selectedId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageId,
          base64: cached.base64,
          mediaType: cached.mediaType,
        }),
      });

      setStrippedIds(prev => {
        const next = new Set(prev);
        next.delete(imageId);
        return next;
      });

      const img = detail?.images.find(i => i.id === imageId);
      if (img) {
        setDetail(prev => prev ? {
          ...prev,
          totalSizeBytes: prev.totalSizeBytes + img.sizeBytes,
          imageSizeBytes: prev.imageSizeBytes + img.sizeBytes,
        } : null);
      }

      imageCache.current.delete(imageId);
      toast.success('Image recovered');
    } catch (err) {
      toast.error(`Recovery failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setOperating(null);
    }
  }, [selectedId, detail, operating, toast]);

  const handleResize = useCallback(async (targetBytes: number, imageIds?: string[]) => {
    if (!selectedId || !detail) return;
    if (operating) return;

    const ids = imageIds ?? detail.images.map(img => img.id);
    const isBulk = !imageIds;

    const doResize = async () => {
      setOperating(`Resizing ${ids.length} image${ids.length > 1 ? 's' : ''}...`);
      try {
        const body: Record<string, unknown> = { targetBytes };
        if (imageIds) body.imageIds = imageIds;

        await fetch(`/api/sessions/${selectedId}/resize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        // Re-fetch detail to get updated sizes
        selectSession(selectedId);
        toast.success(`Resized ${ids.length} image${ids.length > 1 ? 's' : ''} to ${formatBytes(targetBytes)} target`);
      } catch (err) {
        toast.error(`Resize failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      } finally {
        setOperating(null);
      }
    };

    if (isBulk && ids.length > 1) {
      setConfirm({
        title: 'Resize all images',
        message: `This will resize ${ids.length} images to a ${formatBytes(targetBytes)} target. This modifies the session file directly.`,
        confirmLabel: `Resize ${ids.length} images`,
        action: doResize,
      });
    } else {
      doResize();
    }
  }, [selectedId, detail, selectSession, operating, toast]);

  const handleDeleteAllBackups = useCallback(() => {
    setConfirm({
      title: 'Delete all backups',
      message: 'This will permanently delete all backup files. This cannot be undone.',
      confirmLabel: 'Delete all backups',
      action: async () => {
        try {
          await fetch('/api/backups', { method: 'DELETE' });
          toast.success('All backups deleted');
        } catch (err) {
          toast.error(`Delete failed: ${err instanceof Error ? err.message : 'unknown error'}`);
        }
      },
    });
  }, [toast]);

  const clearStripped = useCallback(() => {
    if (!detail) return;
    setDetail(prev => prev ? {
      ...prev,
      images: prev.images.filter(img => !strippedIds.has(img.id)),
      imageCount: prev.images.filter(img => !strippedIds.has(img.id)).length,
    } : null);
    setStrippedIds(new Set());
    imageCache.current.clear();
  }, [detail, strippedIds]);

  // Context menu handlers for session rows -- select session, load detail, then act
  const handleSessionStripAll = useCallback(async (sessionId: string) => {
    // Select and load the session first
    setSelectedId(sessionId);
    setDetailLoading(true);
    setStrippedIds(new Set());
    imageCache.current.clear();
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      const data: SessionDetail = await res.json();
      setDetail(data);
      setDetailLoading(false);

      // Now strip all images
      if (data.images.length === 0) return;
      const ids = data.images.map(img => img.id);
      const totalBytes = data.images.reduce((sum, img) => sum + img.sizeBytes, 0);
      setConfirm({
        title: 'Strip all images',
        message: `This will strip ${ids.length} images (${formatBytes(totalBytes)}) from the session file. Originals will be cached in memory for recovery during this session.`,
        confirmLabel: `Strip ${ids.length} images`,
        action: () => handleStrip(),
      });
    } catch {
      setDetail(null);
      setDetailLoading(false);
    }
  }, [handleStrip]);

  const handleSessionResizeAll = useCallback(async (sessionId: string, targetBytes: number) => {
    setSelectedId(sessionId);
    setDetailLoading(true);
    setStrippedIds(new Set());
    imageCache.current.clear();
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      const data: SessionDetail = await res.json();
      setDetail(data);
      setDetailLoading(false);

      if (data.images.length === 0) return;
      const ids = data.images.map(img => img.id);
      setConfirm({
        title: 'Resize all images',
        message: `This will resize ${ids.length} images to a ${formatBytes(targetBytes)} target. This modifies the session file directly.`,
        confirmLabel: `Resize ${ids.length} images`,
        action: async () => {
          setOperating(`Resizing ${ids.length} images...`);
          try {
            await fetch(`/api/sessions/${sessionId}/resize`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ targetBytes }),
            });
            selectSession(sessionId);
            toast.success(`Resized ${ids.length} images to ${formatBytes(targetBytes)} target`);
          } catch (err) {
            toast.error(`Resize failed: ${err instanceof Error ? err.message : 'unknown error'}`);
          } finally {
            setOperating(null);
          }
        },
      });
    } catch {
      setDetail(null);
      setDetailLoading(false);
    }
  }, [selectSession, toast]);

  const handleExport = useCallback(async () => {
    if (!selectedId) return;
    try {
      const res = await fetch(`/api/sessions/${selectedId}/export`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      // Extract filename from Content-Disposition header
      const disposition = res.headers.get('Content-Disposition');
      let filename = 'session.md';
      if (disposition) {
        const match = disposition.match(/filename="([^"]+)"/);
        if (match) filename = match[1];
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Session exported');
    } catch (err) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }, [selectedId, toast]);

  const handleSearchSelect = useCallback((sessionId: string, tab?: 'chat') => {
    selectSession(sessionId);
    setExpanded(true);
    if (tab) setDetailTab(tab);
  }, [selectSession]);

  const expandSession = useCallback((id: string) => {
    // The single-click handler (onClick) already fires and starts loading.
    // We just need to flag expanded=true. The render condition is `expanded && detail`,
    // so it'll show the full panel as soon as detail arrives.
    setExpanded(true);
  }, []);

  const collapseSession = useCallback(() => {
    setExpanded(false);
  }, []);

  useKeyboard({
    onRefresh: refresh,
    onEscape: showSearch ? () => setShowSearch(false) : expanded ? collapseSession : undefined,
    onSearch: () => setShowSearch(true),
  });

  const totalSize = sessions.reduce((s, x) => s + x.totalSizeBytes, 0);
  const totalImages = sessions.reduce((s, x) => s + x.imageCount, 0);

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <span className={styles.title}>ConClear</span>
        <button className={styles.searchBtn} onClick={() => setShowSearch(true)} title="Global search (Cmd+K)">
          Search All  <kbd className={styles.kbd}>⌘K</kbd>
        </button>
        <span className={styles.stats}>
          {sessions.length} sessions / {formatBytes(totalSize)} / {totalImages} images
        </span>
        <button className={styles.helpBtn} onClick={() => setShowHelp(true)} title="Help">?</button>
      </header>
      <Toolbar
        onRefresh={refresh}
        onStripAll={detail && detail.imageCount > 0 ? () => handleStripWithConfirm() : undefined}
        onResizeAll={detail && detail.imageCount > 0 ? (targetBytes: number) => handleResize(targetBytes) : undefined}
        onClearStripped={strippedIds.size > 0 ? clearStripped : undefined}
        onShowBackups={() => setShowBackups(true)}
        onExport={selectedId ? handleExport : undefined}
        onScan={selectedId ? () => setShowScan(true) : undefined}
        strippedCount={strippedIds.size}
        sessionName={detail?.name ?? detail?.preview ?? detail?.id ?? null}
        operating={operating}
      />
      <BackupManager
        visible={showBackups}
        onClose={() => setShowBackups(false)}
        onDeleteAll={handleDeleteAllBackups}
      />
      <ScanResults
        visible={showScan}
        sessionId={selectedId}
        onClose={() => setShowScan(false)}
      />
      <HelpPanel
        visible={showHelp}
        onClose={() => setShowHelp(false)}
      />
      {expanded && detail ? (
        <div className={styles.fullPanel}>
          <div className={styles.fullPanelHeader}>
            <button className={styles.backBtn} onClick={collapseSession}>← Back</button>
            <span className={styles.fullPanelTitle}>
              {detail.name ?? detail.preview ?? detail.id}
            </span>
            {detail.name && (
              <button
                className={styles.clipboardBtn}
                title="Copy resume command"
                onClick={() => {
                  navigator.clipboard.writeText(`claude --resume "${detail.name}"`);
                  toast.success('Resume command copied');
                }}
              >
                &#x2398;
              </button>
            )}
            <span className={styles.fullPanelMeta}>
              {detail.messageCount} messages / {detail.imageCount} images / {formatBytes(detail.totalSizeBytes)}
            </span>
          </div>
          <div className={styles.detailPane}>
            <div className={styles.tabs}>
              <button
                className={detailTab === 'images' ? styles.tabActive : styles.tab}
                onClick={() => setDetailTab('images')}
              >
                Images ({detail.imageCount})
              </button>
              <button
                className={detailTab === 'timeline' ? styles.tabActive : styles.tab}
                onClick={() => setDetailTab('timeline')}
              >
                Timeline
              </button>
              <button
                className={detailTab === 'chat' ? styles.tabActive : styles.tab}
                onClick={() => setDetailTab('chat')}
              >
                Chat ({detail.messageCount})
              </button>
              <button
                className={detailTab === 'files' ? styles.tabActive : styles.tab}
                onClick={() => setDetailTab('files')}
              >
                Files
              </button>
            </div>
            {detailTab === 'images' && (
              <ImagePreview
                detail={detail}
                loading={detailLoading}
                onStrip={handleStripWithConfirm}
                onRecover={handleRecover}
                onResize={(targetBytes, imageIds) => handleResize(targetBytes, imageIds)}
                strippedIds={strippedIds}
                disabled={!!operating}
              />
            )}
            {detailTab === 'timeline' && (
              <TimelineView sessionId={detail.id} />
            )}
            {detailTab === 'chat' && (
              <ConversationView sessionId={detail.id} />
            )}
            {detailTab === 'files' && (
              <FilesView sessionId={detail.id} />
            )}
          </div>
        </div>
      ) : (
        <PaneLayout
          left={
            <SessionTable
              sessions={sessions}
              loading={loading}
              error={error}
              selectedId={selectedId}
              onSelect={selectSession}
              onExpand={expandSession}
              onStripAll={handleSessionStripAll}
              onResizeAll={handleSessionResizeAll}
            />
          }
          right={
            detail ? (
              <div className={styles.detailPane}>
                <div className={styles.tabs}>
                  <button
                    className={detailTab === 'images' ? styles.tabActive : styles.tab}
                    onClick={() => setDetailTab('images')}
                  >
                    Images ({detail.imageCount})
                  </button>
                  <button
                    className={detailTab === 'timeline' ? styles.tabActive : styles.tab}
                    onClick={() => setDetailTab('timeline')}
                  >
                    Timeline
                  </button>
                  <button
                    className={detailTab === 'chat' ? styles.tabActive : styles.tab}
                    onClick={() => setDetailTab('chat')}
                  >
                    Chat ({detail.messageCount})
                  </button>
                  <button
                    className={detailTab === 'files' ? styles.tabActive : styles.tab}
                    onClick={() => setDetailTab('files')}
                  >
                    Files
                  </button>
                </div>
                {detailTab === 'images' && (
                  <ImagePreview
                    detail={detail}
                    loading={detailLoading}
                    onStrip={handleStripWithConfirm}
                    onRecover={handleRecover}
                    onResize={(targetBytes, imageIds) => handleResize(targetBytes, imageIds)}
                    strippedIds={strippedIds}
                    disabled={!!operating}
                  />
                )}
                {detailTab === 'timeline' && (
                  <TimelineView sessionId={detail.id} />
                )}
                {detailTab === 'chat' && (
                  <ConversationView sessionId={detail.id} />
                )}
                {detailTab === 'files' && (
                  <FilesView sessionId={detail.id} />
                )}
              </div>
            ) : (
              <DiskUsage sessions={sessions} onSelect={selectSession} />
            )
          }
        />
      )}
      <GlobalSearch
        visible={showSearch}
        onClose={() => setShowSearch(false)}
        onSelect={handleSearchSelect}
      />
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onConfirm={() => { setConfirm(null); confirm.action(); }}
          onCancel={() => setConfirm(null)}
        />
      )}
      <ToastContainer toasts={toasts} />
    </div>
  );
}
