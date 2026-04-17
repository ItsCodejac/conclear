import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { SizeIndicator } from '../SizeIndicator';
import * as CtxMenu from '../ContextMenu';
import { decodeProjectName, formatRelative } from '../../utils';
import type { Session, SortField, SortDirection } from '../../types';
import styles from './styles.module.css';

interface SessionTableProps {
  sessions: Session[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onExpand: (id: string) => void;
  onStripAll?: (sessionId: string) => void;
  onResizeAll?: (sessionId: string, targetBytes: number) => void;
}

interface ProjectGroup {
  project: string;
  displayName: string;
  sessions: Session[];
  totalSizeBytes: number;
  imageSizeBytes: number;
  imageCount: number;
}

const formatDate = formatRelative;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function matchesSearch(session: Session, query: string): boolean {
  const q = query.toLowerCase();
  const name = (session.name ?? '').toLowerCase();
  const preview = (session.preview ?? '').toLowerCase();
  const project = session.project.toLowerCase();
  const id = session.id.toLowerCase();
  return name.includes(q) || preview.includes(q) || project.includes(q) || id.includes(q);
}

function truncateId(id: string): string {
  return id.length > 12 ? id.slice(0, 12) + '...' : id;
}

function SessionNameCell({ session }: { session: Session }) {
  if (session.name) {
    return <span>{session.name}</span>;
  }
  if (session.preview) {
    return <span className={styles.previewName}>{session.preview}</span>;
  }
  return <span className={styles.uuidFallback}>{truncateId(session.id)}</span>;
}

function sortSessions(list: Session[], sortField: SortField, sortDir: SortDirection): Session[] {
  return [...list].sort((a, b) => {
    const mul = sortDir === 'asc' ? 1 : -1;
    const av = a[sortField];
    const bv = b[sortField];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === 'string' && typeof bv === 'string') return mul * av.localeCompare(bv);
    return mul * ((av as number) - (bv as number));
  });
}

function buildGroups(
  sessions: Session[],
  sortField: SortField,
  sortDir: SortDirection,
): ProjectGroup[] {
  const map = new Map<string, Session[]>();
  for (const s of sessions) {
    const key = s.project;
    let arr = map.get(key);
    if (!arr) { arr = []; map.set(key, arr); }
    arr.push(s);
  }

  const groups: ProjectGroup[] = [];
  for (const [project, groupSessions] of map) {
    groups.push({
      project,
      displayName: decodeProjectName(project),
      sessions: sortSessions(groupSessions, sortField, sortDir),
      totalSizeBytes: groupSessions.reduce((sum, s) => sum + s.totalSizeBytes, 0),
      imageSizeBytes: groupSessions.reduce((sum, s) => sum + s.imageSizeBytes, 0),
      imageCount: groupSessions.reduce((sum, s) => sum + s.imageCount, 0),
    });
  }

  // Sort groups by image size descending (heaviest projects at top)
  groups.sort((a, b) => b.imageSizeBytes - a.imageSizeBytes);
  return groups;
}

/** Build a flat list of navigable session IDs from visible (non-collapsed) groups */
function buildFlatList(groups: ProjectGroup[], collapsed: Set<string>): Session[] {
  const result: Session[] = [];
  for (const g of groups) {
    if (!collapsed.has(g.project)) {
      for (const s of g.sessions) result.push(s);
    }
  }
  return result;
}

export function SessionTable({ sessions, loading, error, selectedId, onSelect, onExpand, onStripAll, onResizeAll }: SessionTableProps) {
  const [sortField, setSortField] = useState<SortField>('lastActiveAt');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [search, setSearch] = useState('');
  const [focusIndex, setFocusIndex] = useState<number>(-1);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return sessions;
    return sessions.filter(s => matchesSearch(s, search.trim()));
  }, [sessions, search]);

  const groups = useMemo(
    () => buildGroups(filtered, sortField, sortDir),
    [filtered, sortField, sortDir],
  );

  const showToolColumn = useMemo(() => {
    if (sessions.length === 0) return true;
    const firstTool = sessions[0].tool;
    return !sessions.every(s => s.tool === firstTool);
  }, [sessions]);

  const flatList = useMemo(
    () => buildFlatList(groups, collapsed),
    [groups, collapsed],
  );

  // Reset focus index when filter changes
  useEffect(() => {
    setFocusIndex(-1);
  }, [search]);

  // Scroll focused row into view
  useEffect(() => {
    if (focusIndex >= 0) {
      const row = rowRefs.current.get(focusIndex);
      row?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusIndex]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const active = document.activeElement;
    const isInSearch = active === searchRef.current;
    const isInContainer = containerRef.current?.contains(active as Node);

    if (!isInSearch && !isInContainer) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIndex(prev => {
        const next = prev + 1;
        return next < flatList.length ? next : prev;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIndex(prev => {
        const next = prev - 1;
        return next >= 0 ? next : prev;
      });
    } else if (e.key === 'Enter' && focusIndex >= 0 && focusIndex < flatList.length) {
      e.preventDefault();
      onSelect(flatList[focusIndex].id);
    } else if (e.key === '/' && !isInSearch) {
      e.preventDefault();
      searchRef.current?.focus();
    } else if (e.key === 'Escape' && isInSearch) {
      e.preventDefault();
      setSearch('');
      searchRef.current?.blur();
    }
  }, [flatList, focusIndex, onSelect]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const toggleGroup = (project: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(project)) next.delete(project);
      else next.add(project);
      return next;
    });
  };

  if (loading && sessions.length === 0) return <div className={styles.loading}>Loading sessions...</div>;
  if (error) return <div className={styles.error}>Error: {error}</div>;
  if (sessions.length === 0) return <div className={styles.empty}>No sessions found</div>;

  const arrow = (field: SortField) =>
    sortField === field ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';

  // Track flat index across groups for keyboard navigation
  let flatIdx = 0;

  return (
    <div className={styles.container} ref={containerRef} tabIndex={-1}>
      <div className={styles.searchBar}>
        <input
          ref={searchRef}
          className={styles.searchInput}
          type="text"
          placeholder="Filter sessions...  (/)"
          value={search}
          onChange={e => setSearch(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        {search && (
          <span className={styles.searchCount}>
            {filtered.length}/{sessions.length}
          </span>
        )}
      </div>
      {filtered.length === 0 ? (
        <div className={styles.empty}>No matches</div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th onClick={() => handleSort('name')}>Name{arrow('name')}</th>
              <th onClick={() => handleSort('project')}>Project{arrow('project')}</th>
              {showToolColumn && <th onClick={() => handleSort('tool')}>Tool{arrow('tool')}</th>}
              <th onClick={() => handleSort('lastActiveAt')}>Last Active{arrow('lastActiveAt')}</th>
              <th onClick={() => handleSort('totalSizeBytes')}>Size{arrow('totalSizeBytes')}</th>
              <th onClick={() => handleSort('imageCount')}>Img{arrow('imageCount')}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(g => {
              const isCollapsed = collapsed.has(g.project);
              const startIdx = flatIdx;
              if (!isCollapsed) flatIdx += g.sessions.length;
              return (
                <ProjectGroupRows
                  key={g.project}
                  group={g}
                  isCollapsed={isCollapsed}
                  selectedId={selectedId}
                  focusIndex={focusIndex}
                  flatIdxStart={startIdx}
                  rowRefs={rowRefs}
                  onSelect={onSelect}
                  onExpand={onExpand}
                  onToggle={() => toggleGroup(g.project)}
                  onStripAll={onStripAll}
                  onResizeAll={onResizeAll}
                  showToolColumn={showToolColumn}
                />
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface ProjectGroupRowsProps {
  group: ProjectGroup;
  isCollapsed: boolean;
  selectedId: string | null;
  focusIndex: number;
  flatIdxStart: number;
  rowRefs: React.MutableRefObject<Map<number, HTMLTableRowElement>>;
  onSelect: (id: string) => void;
  onExpand: (id: string) => void;
  onToggle: () => void;
  onStripAll?: (sessionId: string) => void;
  onResizeAll?: (sessionId: string, targetBytes: number) => void;
  showToolColumn: boolean;
}

function ProjectGroupRows({
  group,
  isCollapsed,
  selectedId,
  focusIndex,
  flatIdxStart,
  rowRefs,
  onSelect,
  onExpand,
  onToggle,
  onStripAll,
  onResizeAll,
  showToolColumn,
}: ProjectGroupRowsProps) {
  const colCount = showToolColumn ? 6 : 5;
  return (
    <>
      <tr className={styles.groupHeader} onClick={onToggle}>
        <td colSpan={colCount} className={styles.groupHeaderCell}>
          <span className={styles.groupToggle}>{isCollapsed ? '\u25b8' : '\u25be'}</span>
          <span className={styles.groupName}>{group.displayName}</span>
          <span className={styles.groupStats}>
            {group.sessions.length} session{group.sessions.length !== 1 ? 's' : ''}
            {' \u00b7 '}
            {formatBytes(group.totalSizeBytes)}
            {group.imageCount > 0 && (
              <>{' \u00b7 '}{group.imageCount} img ({formatBytes(group.imageSizeBytes)})</>
            )}
          </span>
        </td>
      </tr>
      {!isCollapsed && group.sessions.map((s, i) => {
        const imgClass = s.imageCount > 10 ? styles.imgCountDanger
          : s.imageCount > 0 ? styles.imgCountWarn
          : styles.imgCount;

        const flatI = flatIdxStart + i;
        const isSelected = s.id === selectedId;
        const isFocused = flatI === focusIndex;

        let rowClass = styles.row;
        if (isSelected) rowClass += ` ${styles.selected}`;
        if (isFocused) rowClass += ` ${styles.focused}`;

        return (
          <CtxMenu.Root key={s.id}>
            <CtxMenu.Trigger asChild>
              <tr
                ref={el => {
                  if (el) rowRefs.current.set(flatI, el);
                  else rowRefs.current.delete(flatI);
                }}
                className={rowClass}
                onClick={() => onSelect(s.id)}
                onDoubleClick={() => onExpand(s.id)}
              >
                <td className={styles.nameCell}><SessionNameCell session={s} /></td>
                <td className={styles.projectCell}>{decodeProjectName(s.project)}</td>
                {showToolColumn && <td className={styles.toolCell}>{s.tool}</td>}
                <td>{formatDate(s.lastActiveAt)}</td>
                <td>
                  <SizeIndicator totalBytes={s.totalSizeBytes} imageBytes={s.imageSizeBytes} />
                </td>
                <td className={imgClass}>
                  {s.hasOversizedImages && (
                    <span
                      className={styles.oversizedWarn}
                      title={`Contains oversized images (>${s.maxImageDimension}px) \u2014 may trigger dimension limit warning`}
                    >&#x26A0;</span>
                  )}
                  {s.imageCount}
                  {isSelected && (
                    <span className={styles.expandHint} title="Double-click to expand">&#x21F1;</span>
                  )}
                </td>
              </tr>
            </CtxMenu.Trigger>
            <CtxMenu.Content>
              {s.imageCount > 0 && onStripAll && (
                <CtxMenu.Item danger onSelect={() => onStripAll(s.id)}>
                  Strip All Images
                </CtxMenu.Item>
              )}
              {s.imageCount > 0 && onResizeAll && (
                <CtxMenu.ResizeSubmenu
                  label="Resize All Images"
                  onResize={(bytes) => onResizeAll(s.id, bytes)}
                />
              )}
              {s.imageCount > 0 && (onStripAll || onResizeAll) && (
                <CtxMenu.Separator />
              )}
              {s.name && (
                <CtxMenu.Item onSelect={() => navigator.clipboard.writeText(`claude --resume "${s.name}"`)}>
                  Copy Resume Command
                </CtxMenu.Item>
              )}
              <CtxMenu.Item onSelect={() => navigator.clipboard.writeText(s.id)}>
                Copy Session ID
              </CtxMenu.Item>
              <CtxMenu.Item onSelect={() => navigator.clipboard.writeText(s.filePath)}>
                Copy File Path
              </CtxMenu.Item>
            </CtxMenu.Content>
          </CtxMenu.Root>
        );
      })}
    </>
  );
}
