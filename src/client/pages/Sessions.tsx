import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../lib/icons';
import { clsx, fmtBytes, relTime, MB } from '../lib/format';
import { TOOLS, type Session, type ToolId } from '../lib/types';
import { ToolBadge } from '../components/ToolBadge';
import { Meter } from '../components/Meter';
import { ContextMenu, type ContextItem } from '../extras/ContextMenu';
import { SessionDetail } from './sessions/SessionDetail';

interface Props {
  sessions: Session[];
  projectFilter: string | null;
  openId: string | null;
  onOpenId: (id: string | null) => void;
  toast: (type: 'success' | 'error', msg: string) => void;
}

function healthColor(s: Session & { secretCount?: number; maxSeverity?: string | null }): string {
  if ((s.secretCount ?? 0) > 0 && s.maxSeverity === 'high') return 'var(--danger)';
  if (s.hasOversizedImages) return 'var(--warn)';
  if ((s.secretCount ?? 0) > 0) return 'var(--warn)';
  return 'var(--accent)';
}
function szClass(b: number, big: number): string {
  return b >= big ? 'sz sz-hot' : b >= big / 3 ? 'sz sz-warm' : 'sz sz-cool';
}

export function Sessions({ sessions, projectFilter, openId, onOpenId, toast }: Props) {
  const [query, setQuery] = useState('');
  const [tool, setTool] = useState<'all' | ToolId>('all');
  const [proj, setProj] = useState<string>(projectFilter || 'all');
  const [health, setHealth] = useState<'all' | 'problem' | 'secrets'>('all');
  const inputRef = useRef<HTMLInputElement>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; items: ContextItem[] } | null>(null);

  useEffect(() => { if (projectFilter) setProj(projectFilter); }, [projectFilter]);

  const tools = useMemo<Array<'all' | ToolId>>(() => ['all', ...new Set(sessions.map(s => s.tool))], [sessions]);

  const filtered = useMemo(() => sessions.filter(s => {
    if (tool !== 'all' && s.tool !== tool) return false;
    if (proj !== 'all' && s.project !== proj) return false;
    if (health === 'problem' && !s.hasOversizedImages) return false;
    if (health === 'secrets' && ((s as any).secretCount ?? 0) === 0) return false;
    if (query) {
      const q = query.toLowerCase();
      const blob = `${s.name ?? ''} ${s.preview ?? ''} ${s.project}`.toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  }), [sessions, tool, proj, health, query]);

  const grouped = useMemo(() => {
    const m = new Map<string, Session[]>();
    for (const s of filtered) {
      const arr = m.get(s.project) ?? [];
      arr.push(s);
      m.set(s.project, arr);
    }
    return [...m.entries()].map(([k, v]) => ({
      project: k,
      sessions: v.sort((a, b) => b.lastActiveAt - a.lastActiveAt),
      size: v.reduce((t, x) => t + x.totalSizeBytes, 0),
      images: v.reduce((t, x) => t + x.imageCount, 0),
    })).sort((a, b) => b.size - a.size);
  }, [filtered]);

  const selected = useMemo(() => sessions.find(s => s.id === openId) ?? null, [openId, sessions]);
  const maxGroup = Math.max(...grouped.map(g => g.size), 1);

  // flat list for keyboard nav
  const flat = useMemo(() => grouped.flatMap(g => g.sessions), [grouped]);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const activeId = flat[activeIdx]?.id;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = document.activeElement && /input|textarea/i.test(document.activeElement.tagName);
      if (e.key === '/' && !typing) { e.preventDefault(); inputRef.current?.focus(); return; }
      if (typing && e.key !== 'Escape') return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min((i < 0 ? -1 : i) + 1, flat.length - 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max((i < 0 ? 1 : i) - 1, 0)); }
      if (e.key === 'Enter' && flat[activeIdx]) onOpenId(flat[activeIdx].id);
      if (e.key === 'Escape') {
        if (ctx) setCtx(null);
        else if (document.activeElement === inputRef.current) inputRef.current?.blur();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flat, activeIdx, ctx, onOpenId]);

  function rowMenu(e: React.MouseEvent, s: Session) {
    e.preventDefault();
    const hasImgs = s.imageCount > 0;
    const caps = TOOLS[s.tool].caps;
    setCtx({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Open session', icon: 'chevron', onClick: () => onOpenId(s.id) },
        { sep: true },
        { label: `Strip ${s.imageCount} images`, icon: 'scissors', disabled: !hasImgs,
          onClick: () => {
            onOpenId(s.id);
            toast('success', `Stripped ${s.imageCount} images · ${fmtBytes(s.imageSizeBytes)} freed`);
          } },
        { label: 'Resize → 512 KB', icon: 'resize', disabled: !hasImgs || !caps.resize,
          onClick: () => {
            onOpenId(s.id);
            toast('success', 'Resized all images to 512 KB');
          } },
        { sep: true },
        { label: 'Copy resume command', icon: 'copy', hint: '⌘C',
          onClick: () => {
            void navigator.clipboard.writeText(`${s.tool} --resume "${s.name ?? s.id}"`);
            toast('success', 'Copied resume command');
          } },
        { label: 'Export markdown', icon: 'download', disabled: !caps.exportSession,
          onClick: () => window.open(`/api/sessions/${encodeURIComponent(s.id)}/export`, '_blank') },
      ],
    });
  }

  return (
    <div className={clsx('sess-split', !selected && 'collapsed')}>
      {/* MASTER */}
      <div className="sess-list-wrap">
        <div className="sess-toolbar">
          <div className="searchbox">
            <Icon name="search" size={15} />
            <input ref={inputRef} placeholder="Filter sessions…  ( / )" value={query} onChange={e => setQuery(e.target.value)} />
            {query && <Icon name="close" size={14} style={{ cursor: 'pointer' }} onClick={() => setQuery('')} />}
          </div>
          <div className="sess-filterbar">
            {tools.map(t => (
              <span key={t} className={clsx('chip', tool === t && 'on')} onClick={() => setTool(t)}>
                {t === 'all' ? 'All tools' : TOOLS[t as ToolId].label}
              </span>
            ))}
          </div>
          <div className="sess-filterbar">
            <span className={clsx('chip', health === 'all' && 'on')} onClick={() => setHealth('all')}>All</span>
            <span className={clsx('chip', health === 'problem' && 'on')} onClick={() => setHealth('problem')}
              style={{ color: health === 'problem' ? 'var(--warn)' : undefined }}>
              <Icon name="warn" size={12} /> Oversized
            </span>
            <span className={clsx('chip', health === 'secrets' && 'on')} onClick={() => setHealth('secrets')}
              style={{ color: health === 'secrets' ? 'var(--danger)' : undefined }}>
              <Icon name="key" size={12} /> Secrets
            </span>
            <span style={{ flex: 1 }} />
            <span className="pg-meta">{filtered.length} sessions</span>
          </div>
        </div>

        <div className="sess-scroll">
          {grouped.map(g => (
            <div key={g.project}>
              <div className="proj-group-head">
                <span className="pg-name">{g.project}</span>
                <span className="pg-meta">{g.sessions.length} · {g.images} img</span>
                <span className="pg-bar"><Meter value={g.size} max={maxGroup} h={4} color="var(--surface-3)" /></span>
                <span className="pg-meta">{fmtBytes(g.size)}</span>
              </div>
              {g.sessions.map(s => (
                <div
                  key={s.id}
                  className={clsx('srow', openId === s.id && 'sel', activeId === s.id && 'active-kbd')}
                  onClick={() => onOpenId(s.id)}
                  onContextMenu={e => rowMenu(e, s)}
                >
                  <span className="srow-health" style={{ background: healthColor(s as any) }} />
                  <div className="srow-mid">
                    <div className="srow-name">{s.name ?? s.preview ?? s.id}</div>
                    <div className="srow-sub">
                      <ToolBadge tool={s.tool} />
                      <span>{relTime(s.lastActiveAt)}</span>
                      <span className="mono">{s.messageCount} msg</span>
                    </div>
                  </div>
                  <div className="srow-right">
                    <span className={clsx('srow-size', szClass(s.totalSizeBytes, 30 * MB))}>{fmtBytes(s.totalSizeBytes)}</span>
                    <div className="srow-flags">
                      {s.imageCount > 0 && (
                        <span className="srow-imgmeta">
                          <Icon name="image" size={11} /> {s.imageCount}
                        </span>
                      )}
                      {s.hasOversizedImages && (
                        <span className="flagdot" title="oversized images" style={{ color: 'var(--warn)' }}>
                          <Icon name="warn" size={13} />
                        </span>
                      )}
                      {((s as any).secretCount ?? 0) > 0 && (
                        <span className="flagdot" title="secrets" style={{ color: 'var(--danger)' }}>
                          <Icon name="key" size={12} />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
          {grouped.length === 0 && (
            <div className="empty-state">
              <div className="es-ico"><Icon name="search" size={24} /></div>
              <div className="es-title">No matches</div>
              <div>Try clearing a filter.</div>
            </div>
          )}
        </div>
      </div>

      {selected && <SessionDetail session={selected as any} onClose={() => onOpenId(null)} toast={toast} />}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctx.items} onClose={() => setCtx(null)} />}
    </div>
  );
}
