import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { FileHistory, FileVersion } from '../../types';
import { formatTime } from '../../utils';
import { HighlightText } from '../HighlightText';
import styles from './styles.module.css';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import xml from 'highlight.js/lib/languages/xml';
import rust from 'highlight.js/lib/languages/rust';
import bash from 'highlight.js/lib/languages/bash';
import go from 'highlight.js/lib/languages/go';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import 'highlight.js/styles/atom-one-dark.css';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('css', css);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('go', go);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yaml);

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

const EXT_LANG_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript',
  '.py': 'python', '.pyw': 'python',
  '.css': 'css', '.scss': 'css', '.less': 'css',
  '.json': 'json', '.jsonl': 'json',
  '.md': 'markdown', '.mdx': 'markdown',
  '.html': 'xml', '.htm': 'xml', '.svg': 'xml', '.svelte': 'xml', '.vue': 'xml', '.xml': 'xml',
  '.rs': 'rust',
  '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
  '.go': 'go',
  '.sql': 'sql',
  '.yml': 'yaml', '.yaml': 'yaml',
};

function detectLanguage(filePath: string): string | undefined {
  const dotIdx = filePath.lastIndexOf('.');
  if (dotIdx === -1) return undefined;
  const ext = filePath.slice(dotIdx).toLowerCase();
  return EXT_LANG_MAP[ext];
}

function highlightCode(code: string, lang?: string): string {
  if (lang) {
    try {
      return hljs.highlight(code, { language: lang }).value;
    } catch {
      // fall through
    }
  }
  try {
    return hljs.highlightAuto(code).value;
  } catch {
    return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

/** Simple line-level diff. Returns lines tagged as 'add', 'remove', or 'context'. */
interface DiffLine {
  type: 'add' | 'remove' | 'context';
  text: string;
  oldNum?: number;
  newNum?: number;
}

function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // LCS-based diff (Myers-like with simple O(NM) approach for reasonable file sizes)
  const n = oldLines.length;
  const m = newLines.length;

  // For very large files, fall back to a simpler heuristic
  if (n * m > 2_000_000) {
    return simpleDiff(oldLines, newLines);
  }

  // Build LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const result: DiffLine[] = [];
  let i = n, j = m;
  const stack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({ type: 'context', text: oldLines[i - 1], oldNum: i, newNum: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'add', text: newLines[j - 1], newNum: j });
      j--;
    } else {
      stack.push({ type: 'remove', text: oldLines[i - 1], oldNum: i });
      i--;
    }
  }

  // Reverse since we built it bottom-up
  for (let k = stack.length - 1; k >= 0; k--) {
    result.push(stack[k]);
  }

  return result;
}

function simpleDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  // Simple heuristic for large files: find common prefix/suffix, mark middle as changed
  const result: DiffLine[] = [];
  let prefixLen = 0;
  const minLen = Math.min(oldLines.length, newLines.length);
  while (prefixLen < minLen && oldLines[prefixLen] === newLines[prefixLen]) {
    result.push({ type: 'context', text: oldLines[prefixLen], oldNum: prefixLen + 1, newNum: prefixLen + 1 });
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  // Middle section: all removals then all additions
  for (let i = prefixLen; i < oldLines.length - suffixLen; i++) {
    result.push({ type: 'remove', text: oldLines[i], oldNum: i + 1 });
  }
  for (let j = prefixLen; j < newLines.length - suffixLen; j++) {
    result.push({ type: 'add', text: newLines[j], newNum: j + 1 });
  }

  // Suffix context
  for (let s = suffixLen - 1; s >= 0; s--) {
    const oi = oldLines.length - s;
    const ni = newLines.length - s;
    result.push({ type: 'context', text: oldLines[oldLines.length - 1 - s], oldNum: oi, newNum: ni });
  }

  return result;
}

/** Parse edit content that uses the "--- old ---\n...\n--- new ---\n..." format */
function parseEditContent(content: string): { oldStr: string; newStr: string } | null {
  const oldMarker = '--- old ---\n';
  const newMarker = '\n--- new ---\n';
  const oldIdx = content.indexOf(oldMarker);
  const newIdx = content.indexOf(newMarker);
  if (oldIdx === -1 || newIdx === -1) return null;
  const oldStr = content.slice(oldIdx + oldMarker.length, newIdx);
  const newStr = content.slice(newIdx + newMarker.length);
  return { oldStr, newStr };
}

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
  const [diffMode, setDiffMode] = useState(false);
  const [prevContent, setPrevContent] = useState<string | null>(null);
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

  const loadVersion = useCallback(async (version: FileVersion, showDiff = false) => {
    setSelectedVersion(version);
    setCodeContent(null);
    setPrevContent(null);
    setCodeLoading(true);
    setCopied(false);
    setDiffMode(showDiff);
    setOverlayOpen(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/files/${version.lineNumber}`);
      if (res.ok) {
        const data = await res.json();
        setCodeContent(data.content || null);
      }

      // If diff mode requested, also load previous version
      if (showDiff) {
        const file = files.find(f => f.filePath === version.filePath);
        if (file) {
          const vers = filterVersions(file.versions, opFilter);
          const idx = vers.findIndex(v => v.lineNumber === version.lineNumber);
          if (idx > 0) {
            const prevVer = vers[idx - 1];
            const prevRes = await fetch(`/api/sessions/${sessionId}/files/${prevVer.lineNumber}`);
            if (prevRes.ok) {
              const prevData = await prevRes.json();
              setPrevContent(prevData.content || null);
            }
          }
        }
      }
    } catch {
      setCodeContent(null);
    } finally {
      setCodeLoading(false);
    }
  }, [sessionId, files, opFilter]);

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

  // Toggle diff mode from overlay header
  const toggleDiff = useCallback(async () => {
    if (!selectedVersion) return;
    if (diffMode) {
      setDiffMode(false);
      setPrevContent(null);
      return;
    }
    // Load previous version content
    const file = files.find(f => f.filePath === selectedVersion.filePath);
    if (!file) return;
    const vers = filterVersions(file.versions, opFilter);
    const idx = vers.findIndex(v => v.lineNumber === selectedVersion.lineNumber);
    if (idx <= 0) return;

    setDiffMode(true);
    const prevVer = vers[idx - 1];
    try {
      const prevRes = await fetch(`/api/sessions/${sessionId}/files/${prevVer.lineNumber}`);
      if (prevRes.ok) {
        const prevData = await prevRes.json();
        setPrevContent(prevData.content || null);
      }
    } catch {
      setPrevContent(null);
    }
  }, [selectedVersion, diffMode, files, opFilter, sessionId]);

  // Can the current version show a diff?
  const canDiff = useMemo(() => {
    if (!selectedVersion) return false;
    return currentVersionIndex > 0;
  }, [selectedVersion, currentVersionIndex]);

  // Compute highlighted lines
  const highlightedLines = useMemo(() => {
    if (!codeContent || !selectedVersion) return [];
    const lang = detectLanguage(selectedVersion.filePath);
    const highlighted = highlightCode(codeContent, lang);
    return highlighted.split('\n');
  }, [codeContent, selectedVersion]);

  // Compute diff lines when in diff mode
  const diffLines = useMemo((): DiffLine[] => {
    if (!diffMode || !codeContent) return [];

    // If current version is an edit with old/new markers, use those directly
    if (selectedVersion?.operation === 'edit') {
      const parsed = parseEditContent(codeContent);
      if (parsed) {
        return computeLineDiff(parsed.oldStr, parsed.newStr);
      }
    }

    // If we have previous version content, diff against it
    if (prevContent !== null) {
      // For edits that have old/new format, extract the "new" part
      let currentText = codeContent;
      const parsedCurrent = parseEditContent(codeContent);
      if (parsedCurrent) currentText = parsedCurrent.newStr;

      let previousText = prevContent;
      const parsedPrev = parseEditContent(prevContent);
      if (parsedPrev) previousText = parsedPrev.newStr;

      return computeLineDiff(previousText, currentText);
    }

    return [];
  }, [diffMode, codeContent, prevContent, selectedVersion]);

  if (loading) return <div className={styles.loading}>Loading file history...</div>;
  if (files.length === 0) return <div className={styles.empty}>No file operations found in this session</div>;

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
                <div className={styles.fileName}><HighlightText text={baseName(file.filePath)} query={filter} /></div>
                <div className={styles.fileDir}><HighlightText text={dirPath(file.filePath)} query={filter} /></div>
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
                        {i > 0 && (
                          <button
                            className={styles.compareBtn}
                            onClick={e => {
                              e.stopPropagation();
                              loadVersion(v, true);
                            }}
                          >
                            Compare
                          </button>
                        )}
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
                {canDiff && (
                  <button
                    className={diffMode ? styles.overlayBtnActive : styles.overlayBtn}
                    onClick={toggleDiff}
                  >
                    {diffMode ? 'Diff ON' : 'Diff'}
                  </button>
                )}
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
            {diffMode && diffLines.length > 0 ? (
              <div className={styles.diffContainer}>
                <div className={styles.diffHeader}>
                  Comparing with previous version
                  <div className={styles.diffStats}>
                    <span className={styles.diffStatAdd}>+{diffLines.filter(l => l.type === 'add').length} added</span>
                    <span className={styles.diffStatRemove}>-{diffLines.filter(l => l.type === 'remove').length} removed</span>
                  </div>
                </div>
                {diffLines.map((dl, i) => (
                  <div
                    key={i}
                    className={
                      dl.type === 'add' ? styles.diffLineAdded :
                      dl.type === 'remove' ? styles.diffLineRemoved :
                      styles.diffLineContext
                    }
                  >
                    <span className={styles.diffLineNum}>
                      {dl.oldNum ?? ''}
                    </span>
                    <span className={styles.diffLineNum}>
                      {dl.newNum ?? ''}
                    </span>
                    <span className={
                      dl.type === 'add' ? styles.diffGutterAdd :
                      dl.type === 'remove' ? styles.diffGutterRemove :
                      styles.diffGutterContext
                    }>
                      {dl.type === 'add' ? '+' : dl.type === 'remove' ? '-' : ' '}
                    </span>
                    <span className={
                      dl.type === 'add' ? styles.diffTextAdd :
                      dl.type === 'remove' ? styles.diffTextRemove :
                      styles.diffTextContext
                    }>
                      {dl.text}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.overlayCode}>
                {codeLoading && <div className={styles.codeLoading}>Loading content...</div>}
                {!codeLoading && codeContent === null && <div className={styles.codeLoading}>Content not available</div>}
                {!codeLoading && codeContent !== null && highlightedLines.map((line, i) => (
                  <div key={i} className={styles.codeLine}>
                    <span className={styles.lineNum}>{i + 1}</span>
                    <span
                      className={styles.lineTextHighlighted}
                      dangerouslySetInnerHTML={{ __html: line }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
