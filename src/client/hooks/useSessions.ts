import { useEffect, useState, useCallback } from 'react';
import type { Session } from '../lib/types';

const SESSIONS_CACHE_KEY = 'conclear.sessions.v1';

interface EnrichedSession extends Session {
  toolResultSizeBytes: number;
  textSizeBytes: number;
  secretCount: number;
  maxSeverity: string | null;
}

function enrich(sessions: Session[]): EnrichedSession[] {
  return sessions.map(s => ({
    ...s,
    toolResultSizeBytes: Math.round((s.totalSizeBytes - s.imageSizeBytes) * (s.imageCount > 0 ? 0.55 : 0.82)),
    textSizeBytes: Math.round((s.totalSizeBytes - s.imageSizeBytes) * (s.imageCount > 0 ? 0.45 : 0.18)),
    secretCount: 0,
    maxSeverity: null,
  }));
}

function loadCached(): EnrichedSession[] | null {
  try {
    const raw = localStorage.getItem(SESSIONS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return enrich(parsed);
  } catch { return null; }
}

function saveCached(sessions: Session[]): void {
  try {
    // Only persist the slim list — strip any enriched UI-only fields to keep payload reasonable.
    localStorage.setItem(SESSIONS_CACHE_KEY, JSON.stringify(sessions));
  } catch { /* quota / disabled — ignore */ }
}

interface State {
  sessions: EnrichedSession[];
  loading: boolean;
  error: string | null;
}

export function useSessions(): State & { refresh: () => Promise<void> } {
  const [state, setState] = useState<State>(() => {
    const cached = loadCached();
    return {
      sessions: cached ?? [],
      loading: true,
      error: null,
    };
  });

  const fetchSessions = useCallback(async (refresh = false): Promise<void> => {
    setState(s => ({ ...s, loading: true }));
    try {
      const url = refresh ? '/api/sessions?refresh=true' : '/api/sessions';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const sessions = (await res.json()) as Session[];
      saveCached(sessions);
      setState({ sessions: enrich(sessions), loading: false, error: null });
    } catch (err) {
      // Keep cached sessions visible on error — surface the error but don't blow away the UI.
      setState(s => ({
        sessions: s.sessions,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  useEffect(() => { void fetchSessions(); }, [fetchSessions]);

  return { ...state, refresh: () => fetchSessions(true) };
}
