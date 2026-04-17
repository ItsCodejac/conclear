import { useState, useEffect, useMemo } from 'react';
import type { TimelineEvent, TimelineEventType } from '../../types';
import { formatTime } from '../../utils';
import styles from './styles.module.css';

interface TimelineViewProps {
  sessionId: string;
}

const TYPE_LABELS: Record<TimelineEventType, string> = {
  user: 'USER',
  assistant: 'ASST',
  edit: 'EDIT',
  read: 'READ',
  write: 'WRITE',
  bash: 'BASH',
  search: 'FIND',
  agent: 'AGENT',
  image: 'IMG',
  error: 'ERR',
};

const TYPE_FILTERS: TimelineEventType[] = [
  'user', 'assistant', 'edit', 'bash', 'read', 'search', 'agent', 'image', 'error',
];

function timeStr(ts?: string): string {
  if (!ts) return '     ';
  return formatTime(ts);
}

function durationStr(ms?: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function TimelineView({ sessionId }: TimelineViewProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<Set<TimelineEventType>>(new Set(TYPE_FILTERS));
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    setEvents([]);
    setFilter('');
    setExpandedIds(new Set());
    fetch(`/api/sessions/${sessionId}/conversation`)
      .then(r => r.json())
      .then(data => setEvents(data.timeline || []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [sessionId]);

  const toggleType = (t: TimelineEventType) => {
    setTypeFilter(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const filtered = useMemo(() => {
    let result = events.filter(e => typeFilter.has(e.type));
    if (filter) {
      const q = filter.toLowerCase();
      result = result.filter(e =>
        e.summary.toLowerCase().includes(q) ||
        (e.detail && e.detail.toLowerCase().includes(q)) ||
        (e.filePath && e.filePath.toLowerCase().includes(q))
      );
    }
    return result;
  }, [events, typeFilter, filter]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) return <div className={styles.loading}>Loading timeline...</div>;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <input
          className={styles.searchInput}
          placeholder="Search events..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <span className={styles.count}>{filtered.length} / {events.length}</span>
      </div>
      <div className={styles.typeFilters}>
        {TYPE_FILTERS.map(t => (
          <button
            key={t}
            className={typeFilter.has(t) ? styles.typeFilterActive : styles.typeFilterBtn}
            onClick={() => toggleType(t)}
          >
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      <div className={styles.events}>
        {filtered.map(evt => (
          <div
            key={evt.id}
            className={`${styles.event} ${styles[`event_${evt.type}`] || ''}`}
            onClick={() => evt.detail && toggleExpand(evt.id)}
          >
            <span className={styles.time}>{timeStr(evt.timestamp)}</span>
            <span className={`${styles.typeLabel} ${styles[`type_${evt.type}`] || ''}`}>
              {TYPE_LABELS[evt.type]}
            </span>
            <span className={styles.summary}>{evt.summary}</span>
            {evt.durationMs && (
              <span className={styles.duration}>{durationStr(evt.durationMs)}</span>
            )}
            {evt.detail && (
              <span className={styles.expandIcon}>
                {expandedIds.has(evt.id) ? '▾' : '▸'}
              </span>
            )}
            {expandedIds.has(evt.id) && evt.detail && (
              <div className={styles.detail}>{evt.detail}</div>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className={styles.empty}>
            {filter ? 'No matching events' : 'No events'}
          </div>
        )}
      </div>
    </div>
  );
}
