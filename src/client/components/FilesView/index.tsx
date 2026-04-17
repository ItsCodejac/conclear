import { useState, useEffect, useMemo, useCallback } from 'react';
import type { FileHistory, FileVersion } from '../../types';
import styles from './styles.module.css';

interface FilesViewProps {
  sessionId: string;
}

function timeStr(ts?: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortPath(fp: string): string {
  const parts = fp.split('/');
  if (parts.length <= 3) return fp;
  return '.../' + parts.slice(-3).join('/');
}

const OP_LABELS: Record<string, string> = { read: 'READ', edit: 'EDIT', write: 'WRITE' };

export function FilesView({ sessionId }: FilesViewProps) {
  const [files, setFiles] = useState<FileHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<FileVersion | null>(null);
  const [codeContent, setCodeContent] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoading(true);
    setFiles([]);
    setFilter('');
    setExpandedFile(null);
    setSelectedVersion(null);
    setCodeContent(null);
    fetch(`/api/sessions/${sessionId}/files`)
      .then(r => r.json())
      .then(data => setFiles(data || []))
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  }, [sessionId]);

  const filtered = useMemo(() => {
    if (!filter) return files;
    const q = filter.toLowerCase();
    return files.filter(f => f.filePath.toLowerCase().includes(q));
  }, [files, filter]);

  const totalVersions = useMemo(() => files.reduce((s, f) => s + f.versions.length, 0), [files]);

  const toggleFile = useCallback((fp: string) => {
    setExpandedFile(prev => prev === fp ? null : fp);
    setSelectedVersion(null);
    setCodeContent(null);
  }, []);

  const loadVersion = useCallback(async (version: FileVersion) => {
    setSelectedVersion(version);
    setCodeContent(null);
    setCodeLoading(true);
    setCopied(false);
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

  const handleCopy = useCallback(() => {
    if (!codeContent) return;
    navigator.clipboard.writeText(codeContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [codeContent]);

  const opCounts = useCallback((versions: FileVersion[]) => {
    const counts = { read: 0, edit: 0, write: 0 };
    for (const v of versions) counts[v.operation]++;
    return counts;
  }, []);

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
      <div className={styles.splitPane}>
        <div className={styles.fileList}>
          {filtered.map(file => {
            const counts = opCounts(file.versions);
            const isExpanded = expandedFile === file.filePath;
            return (
              <div key={file.filePath}>
                <div
                  className={isExpanded ? styles.fileItemActive : styles.fileItem}
                  onClick={() => toggleFile(file.filePath)}
                >
                  <div className={styles.filePath}>{shortPath(file.filePath)}</div>
                  <div className={styles.fileMeta}>
                    <span>{file.versions.length} version{file.versions.length !== 1 ? 's' : ''}</span>
                    {counts.read > 0 && <span className={`${styles.opCount} ${styles.opRead}`}>{counts.read} read</span>}
                    {counts.edit > 0 && <span className={`${styles.opCount} ${styles.opEdit}`}>{counts.edit} edit</span>}
                    {counts.write > 0 && <span className={`${styles.opCount} ${styles.opWrite}`}>{counts.write} write</span>}
                  </div>
                </div>
                {isExpanded && (
                  <div className={styles.versionList}>
                    {file.versions.map((v, i) => {
                      const isActive = selectedVersion?.lineNumber === v.lineNumber;
                      return (
                        <div
                          key={`${v.lineNumber}-${i}`}
                          className={isActive ? styles.versionActive : styles.version}
                          onClick={() => loadVersion(v)}
                        >
                          <span className={styles.versionTime}>{timeStr(v.timestamp)}</span>
                          <span className={`${styles.versionOp} ${styles[`versionOp${v.operation.charAt(0).toUpperCase() + v.operation.slice(1)}`]}`}>
                            {OP_LABELS[v.operation]}
                          </span>
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
        {selectedVersion && (
          <div className={styles.codePanel}>
            <div className={styles.codePanelHeader}>
              <span className={styles.codePanelPath}>{selectedVersion.filePath}</span>
              <span className={styles.codePanelMeta}>
                {OP_LABELS[selectedVersion.operation]} / {selectedVersion.lineCount}L / {formatBytes(selectedVersion.sizeBytes)}
              </span>
              <button
                className={copied ? styles.copyBtnDone : styles.copyBtn}
                onClick={handleCopy}
                disabled={!codeContent}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className={styles.codeViewer}>
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
        )}
      </div>
    </div>
  );
}
