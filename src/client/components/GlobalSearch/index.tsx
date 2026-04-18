import { useState, useEffect, useRef, useCallback } from 'react';
import type { SearchResult } from '../../types';
import { HighlightText } from '../HighlightText';
import { formatDateTime } from '../../utils';
import { decodeProjectName } from '../../utils';
import styles from './styles.module.css';

interface GlobalSearchProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (sessionId: string, tab?: 'chat') => void;
}

export function GlobalSearch({ visible, onClose, onSelect }: GlobalSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when modal opens
  useEffect(() => {
    if (visible) {
      setQuery('');
      setResults([]);
      setSearched(false);
      setActiveIndex(0);
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [visible]);

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (abortRef.current) abortRef.current.abort();

    if (q.length < 2) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=50`, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        const data: SearchResult[] = await res.json();
        setResults(data);
        setSearched(true);
        setActiveIndex(0);
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setResults([]);
        setSearched(true);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  const handleInputChange = useCallback((value: string) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (value.trim().length < 2) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(() => doSearch(value.trim()), 300);
  }, [doSearch]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const selectResult = useCallback((result: SearchResult) => {
    onSelect(result.sessionId, 'chat');
    onClose();
  }, [onSelect, onClose]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, results.length - 1));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
      return;
    }

    if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      selectResult(results[activeIndex]);
      return;
    }
  }, [results, activeIndex, selectResult, onClose]);

  // Scroll active result into view
  useEffect(() => {
    if (!resultsRef.current) return;
    const active = resultsRef.current.children[activeIndex] as HTMLElement | undefined;
    if (active) {
      active.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  if (!visible) return null;

  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.modal}>
        <div className={styles.inputWrap}>
          <span className={styles.searchIcon}>&#x1F50D;</span>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            placeholder="Search all sessions..."
            value={query}
            onChange={e => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
          <span className={styles.hint}>ESC to close</span>
        </div>

        {(loading || searched) && (
          <div className={styles.status}>
            {loading ? 'Searching...' : `${results.length} result${results.length !== 1 ? 's' : ''}`}
          </div>
        )}

        <div className={styles.results} ref={resultsRef}>
          {searched && !loading && results.length === 0 && (
            <div className={styles.empty}>No results found</div>
          )}

          {results.map((r, idx) => (
            <div
              key={`${r.sessionId}-${r.lineNumber}`}
              className={idx === activeIndex ? styles.resultActive : styles.result}
              onClick={() => selectResult(r)}
              onMouseEnter={() => setActiveIndex(idx)}
            >
              <div className={styles.resultHeader}>
                <span className={styles.sessionName}>
                  {r.sessionName || r.sessionId.slice(0, 12)}
                </span>
                <span className={styles.project}>{decodeProjectName(r.project)}</span>
                <span className={r.role === 'user' ? styles.roleUser : styles.roleAssistant}>
                  {r.role}
                </span>
                {r.timestamp && (
                  <span className={styles.timestamp}>{formatDateTime(r.timestamp)}</span>
                )}
              </div>
              <div className={styles.matchText}>
                <HighlightText text={r.text} query={query} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
