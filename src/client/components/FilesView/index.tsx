import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { FileHistory, FileVersion } from '../../types';
import { formatTime } from '../../utils';
import styles from './styles.module.css';

interface FilesViewProps {
  sessionId: string;
}

type OpFilter = 'all' | 'edits_writes';

function timeStr(ts?: string): string {
  if (!ts) return '';
  return formatTime(ts);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function baseName(fp: string): string {
  const parts = fp.split('/');
  return parts[parts.length - 1] || fp;
}

function dirPath(fp: string): string {
  const parts = fp.split('/');
  if (parts.length <= 1) return '';
  return parts.slice(0, -1).join('/') + '/';
}

/** Try to extract a line-change summary like [+3 -2] from a contentPreview */
function lineChangeSummary(preview: string): string | null {
  // Look for patterns like "+3 -2", "added 3 removed 2", or similar in preview
  const match = preview.match(/\[?\+(\d+)\s*-(\d+)\]?/);
  if (match) return `[+${match[1]} -${match[2]}]`;
  return null;
}

const OP_LABELS: Record<string, string> = { read: 'read', edit: 'EDIT', write: 'WRITE' };

function filterVersions(versions: FileVersion[], opFilter: OpFilter): FileVersion[] {
  if (opFilter === 'all') return versions;
  return versions.filter(v => v.operation === 'edit' || v.operation === 'write');
}

export function FilesView({ sessionId }: FilesViewProps) {
  const [files, setFiles] = useState<FileHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [opFilter, setOpFilter] = useState<OpFilter>('edits_writes');
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<FileVersion | null>(null);
  const [codeContent, setCodeContent] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // For navigating versions in overlay
  const currentFileVersions = useMemo(() => {
    if (!selectedVersion) return [];
    const file = files.find(f => f.filePath === selectedVersion.filePath);
    if (!file) return [];
    return filterVersions(file.versions, opFilter);
  }, [files, selectedVersion, opFilter]);

  const currentVersionIndex = useMemo(() => {
    if (!selectedVersion) return -1;
    return currentFileVersions.findIndex(v => v.lineNumber === selectedVersion.lineNumber);
  }, [currentFileVersions, selectedVersion]);

  useEffect(() => {
    setLoading(true);
    setFiles([]);
    setFilter('');
    setExpandedFile(null);
    setSelectedVersion(null);
    setCodeContent(null);
    setOverlayOpen(false);
    fetch(`/api/sessions/${sessionId}/files`)
      .then(r => r.json())
      .then(data => setFiles(data || []))
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  }, [sessionId]);

  // Reset state on search change
  useEffect(() => {
    setExpandedFile(null);
    setSelectedVersion(null);
    setCodeContent(null);
    setOverlayOpen(false);
  }, [filter]);

  // ESC to close overlay
  useEffect(() => {
    if (!overlayOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOverlayOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [overlayOpen]);

  // Apply both text filter and op filter
  const filtered = useMemo(() => {
    let result = files;
    if (filter) {
      const q = filter.toLowerCase();
      result = result.filter(f => f.filePath.toLowerCase().includes(q));
    }
    if (opFilter === 'edits_writes') {
      result = result.filter(f => f.versions.some(v => v.operation === 'edit' || v.operation === 'write'));
    }
    return result;
  }, [files, filter, opFilter]);

  const totalVersions = useMemo(() => {
    return filtered.reduce((s, f) => s + filterVersions(f.versions, opFilter).length, 0);
  }, [filtered, opFilter]);

  const toggleFile = useCallback((fp: string) => {
    setExpandedFile(prev => prev === fp ? null : fp);
  }, []);

  const loadVersion = useCallback(async (version: FileVersion) => {
    setSelectedVersion(version);
    setCodeContent(null);
    setCodeLoading(true);
    setCopied(false);
    setOverlayOpen(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/files/${version.lineNumber}`);
      if (res.ok) {
        const data = await res.json();
        setCodeContent(data.content || null);
      }
    } catch {
      setCodeContent(null);
    } finally {
      setCodeLoading(false);
    }
  }, [sessionId]);

  const navigateVersion = useCallback((direction: -1 | 1) => {
    const newIndex = currentVersionIndex + direction;
    if (newIndex < 0 || newIndex >= currentFileVersions.length) return;
    const nextVersion = currentFileVersions[newIndex];
    loadVersion(nextVersion);
  }, [currentVersionIndex, currentFileVersions, loadVersion]);

  const handleCopy = useCallback(() => {
    if (!codeContent) return;
    navigator.clipboard.writeText(codeContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [codeContent]);

  const opCounts = useCallback((versions: FileVersion[]) => {
    const filtered = filterVersions(versions, opFilter);
    const counts = { read: 0, edit: 0, write: 0 };
    for (const v of filtered) counts[v.operation]++;
    return counts;
  }, [opFilter]);

  const versionCountForFile = useCallback((versions: FileVersion[]) => {
    return filterVersions(versions, opFilter).length;
  }, [opFilter]);

  if (loading) return <div className={styles.loading}>Loading file history...</div>;
  if (files.length === 0) return <div className={styles.empty}>No file operations found in this session</div>;

  const codeLines = codeContent ? codeContent.split('\n') : [];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <input
          className={styles.searchInput}
          placeholder="Search files..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <span className={styles.count}>{filtered.length} files / {totalVersions} versions</span>
      </div>
      <div className={styles.filterBar}>
        <span className={styles.filterLabel}>Show:</span>
        <button
          className={opFilter === 'edits_writes' ? styles.filterBtnActive : styles.filterBtn}
          onClick={() => setOpFilter('edits_writes')}
        >
          Edits + Writes
        </button>
        <button
          className={opFilter === 'all' ? styles.filterBtnActive : styles.filterBtn}
          onClick={() => setOpFilter('all')}
        >
          All
        </button>
      </div>
      <div className={styles.fileList}>
        {filtered.map(file => {
          const counts = opCounts(file.versions);
          const vCount = versionCountForFile(file.versions);
          const isExpanded = expandedFile === file.filePath;
          const versionsToShow = filterVersions(file.versions, opFilter);
          return (
            <div key={file.filePath}>
              <div
                className={isExpanded ? styles.fileItemActive : styles.fileItem}
                onClick={() => toggleFile(file.filePath)}
              >
                <div className={styles.fileName}>{baseName(file.filePath)}</div>
                <div className={styles.fileDir}>{dirPath(file.filePath)}</div>
                <div className={styles.fileMeta}>
                  <span>{vCount} version{vCount !== 1 ? 's' : ''}</span>
                  {opFilter === 'all' && counts.read > 0 && <span className={`${styles.opCount} ${styles.opRead}`}>{counts.read} read</span>}
                  {counts.edit > 0 && <span className={`${styles.opCount} ${styles.opEdit}`}>{counts.edit} edit</span>}
                  {counts.write > 0 && <span className={`${styles.opCount} ${styles.opWrite}`}>{counts.write} write</span>}
                </div>
              </div>
              {isExpanded && (
                <div className={styles.versionList}>
                  {versionsToShow.map((v, i) => {
                    const changeSummary = v.operation === 'edit' ? lineChangeSummary(v.contentPreview) : null;
                    return (
                      <div
                        key={`${v.lineNumber}-${i}`}
                        className={selectedVersion?.lineNumber === v.lineNumber ? styles.versionActive : styles.version}
                        onClick={() => loadVersion(v)}
                      >
                        <span className={styles.versionTime}>{timeStr(v.timestamp)}</span>
                        <span className={`${styles.versionOp} ${styles[`versionOp${v.operation.charAt(0).toUpperCase() + v.operation.slice(1)}`]}`}>
                          {OP_LABELS[v.operation]}
                        </span>
                        {changeSummary && (
                          <span className={styles.versionSummary}>{changeSummary}</span>
                        )}
                        <span className={styles.versionMeta}>
                          {v.lineCount}L / {formatBytes(v.sizeBytes)}
                        </span>
                        <span className={styles.versionPreview}>
                          {v.contentPreview.replace(/\n/g, ' ').slice(0, 80)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className={styles.empty}>{filter ? 'No matching files' : 'No files'}</div>
        )}
      </div>

      {/* Full-screen code overlay */}
      {overlayOpen && selectedVersion && (
        <div className={styles.overlay} ref={overlayRef} onClick={e => {
          if (e.target === overlayRef.current) setOverlayOpen(false);
        }}>
          <div className={styles.overlayInner}>
            <div className={styles.overlayHeader}>
              <div className={styles.overlayPathBlock}>
                <div className={styles.overlayFilePath}>{selectedVersion.filePath}</div>
                <div className={styles.overlayMeta}>
                  {timeStr(selectedVersion.timestamp)} &middot; {OP_LABELS[selectedVersion.operation].toUpperCase()} &middot; {selectedVersion.lineCount} lines &middot; {formatBytes(selectedVersion.sizeBytes)}
                </div>
              </div>
              <div className={styles.overlayActions}>
                <button
                  className={styles.overlayBtn}
                  onClick={() => navigateVersion(-1)}
                  disabled={currentVersionIndex <= 0}
                >
                  &larr; Prev
                </button>
                <span className={styles.navLabel}>
                  {currentVersionIndex + 1} / {currentFileVersions.length}
                </span>
                <button
                  className={styles.overlayBtn}
                  onClick={() => navigateVersion(1)}
                  disabled={currentVersionIndex >= currentFileVersions.length - 1}
                >
                  Next &rarr;
                </button>
                <button
                  className={copied ? styles.overlayBtnCopied : styles.overlayBtn}
                  onClick={handleCopy}
                  disabled={!codeContent}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button className={styles.overlayClose} onClick={() => setOverlayOpen(false)}>
                  &times;
                </button>
              </div>
            </div>
            <div className={styles.overlayCode}>
              {codeLoading && <div className={styles.codeLoading}>Loading content...</div>}
              {!codeLoading && codeContent === null && <div className={styles.codeLoading}>Content not available</div>}
              {!codeLoading && codeContent !== null && codeLines.map((line, i) => (
                <div key={i} className={styles.codeLine}>
                  <span className={styles.lineNum}>{i + 1}</span>
                  <span className={styles.lineText}>{line}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
