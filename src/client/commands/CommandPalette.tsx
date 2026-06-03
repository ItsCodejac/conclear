import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../lib/icons';
import { clsx } from '../lib/format';
import { ToolBadge } from '../components/ToolBadge';
import type { Session } from '../lib/types';

interface Props {
  sessions: Session[];
  onClose: () => void;
  onOpen: (id: string) => void;
}

interface Result {
  id: string;
  kind: 'session' | 'message';
  label: string;
  snippet: string;
  session: Session;
  match?: string;
}

export function CommandPalette({ sessions, onClose, onOpen }: Props) {
  const [q, setQ] = useState('');
  const [proj, setProj] = useState<string>('all');
  const [active, setActive] = useState(0);
  const [serverResults, setServerResults] = useState<Result[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const projects = useMemo(() => ['all', ...new Set(sessions.map(s => s.project))], [sessions]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActive(0); }, [q, proj]);

  // hit the global search endpoint when the query is meaningful
  useEffect(() => {
    if (q.length < 2) { setServerResults([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, limit: '12' });
        if (proj !== 'all') params.set('project', proj);
        const res = await fetch(`/api/search?${params}`);
        if (!res.ok || cancelled) return;
        const hits = await res.json() as Array<{
          sessionId: string; sessionName: string | null; project: string; tool: string;
          role: string; text: string; timestamp?: string;
        }>;
        const mapped: Result[] = hits.map(h => {
          const s = sessions.find(x => x.id === h.sessionId);
          if (!s) return null;
          return { id: h.sessionId, kind: 'message', label: h.sessionName ?? s.name ?? s.preview ?? s.id, snippet: h.text, session: s, match: q };
        }).filter(Boolean) as Result[];
        if (!cancelled) setServerResults(mapped);
      } catch { /* ignore */ }
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, proj, sessions]);

  const results: Result[] = useMemo(() => {
    const inProj = (s: Session) => proj === 'all' || s.project === proj;
    if (!q || q.length < 2) {
      return sessions.filter(inProj).slice(0, 8).map(s => ({
        id: s.id, kind: 'session', label: s.name ?? s.preview ?? s.id,
        snippet: s.preview ?? '', session: s,
      }));
    }
    const ql = q.toLowerCase();
    const sessionHits: Result[] = [];
    for (const s of sessions) {
      if (!inProj(s)) continue;
      if ((s.name ?? '').toLowerCase().includes(ql) || (s.preview ?? '').toLowerCase().includes(ql)) {
        sessionHits.push({
          id: s.id, kind: 'session', label: s.name ?? s.preview ?? s.id,
          snippet: s.preview ?? '', session: s, match: q,
        });
      }
    }
    return [...sessionHits, ...serverResults].slice(0, 14);
  }, [q, proj, sessions, serverResults]);

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    if (e.key === 'Enter' && results[active]) onOpen(results[active].id);
  }

  function highlight(snip: string, match?: string) {
    if (!match) return snip;
    const i = snip.toLowerCase().indexOf(match.toLowerCase());
    if (i < 0) return snip;
    return <>{snip.slice(0, i)}<mark>{snip.slice(i, i + match.length)}</mark>{snip.slice(i + match.length)}</>;
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="palette" onClick={e => e.stopPropagation()}>
        <div className="palette-input">
          <Icon name="search" size={18} style={{ color: 'var(--muted2)' }} />
          <input
            ref={inputRef}
            placeholder="Search sessions and messages…"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={handleKey}
          />
          <span className="kbd">ESC</span>
        </div>
        <div className="palette-scope">
          <Icon name="filter" size={13} style={{ color: 'var(--faint)' }} />
          {projects.slice(0, 7).map(p => (
            <span key={p} className={clsx('chip', proj === p && 'on')} onClick={() => setProj(p)}>
              {p === 'all' ? 'All projects' : p}
            </span>
          ))}
        </div>
        <div className="palette-results">
          {results.length === 0 && (
            <div className="pres-snip" style={{ padding: 16 }}>No matches.</div>
          )}
          {results.map((r, i) => (
            <div
              key={`${r.id}-${i}`}
              className={clsx('pres', active === i && 'active')}
              onMouseEnter={() => setActive(i)}
              onClick={() => onOpen(r.id)}
            >
              <Icon name={r.kind === 'message' ? 'chat' : 'sessions'} size={16} style={{ color: 'var(--muted2)' }} />
              <div style={{ minWidth: 0 }}>
                <div className="srow-name" style={{ fontSize: 13 }}>{r.label}</div>
                <div className="pres-snip">{highlight(r.snippet || '', r.match)}</div>
              </div>
              <div className="pres-meta"><ToolBadge tool={r.session.tool} /><Icon name="chevron" size={13} /></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
