import { useEffect, useState, useCallback } from 'react';
import type { Session } from '../lib/types';

interface State {
  sessions: Session[];
  loading: boolean;
  error: string | null;
}

export function useSessions(): State & { refresh: () => Promise<void> } {
  const [state, setState] = useState<State>({ sessions: [], loading: true, error: null });

  const fetchSessions = useCallback(async (refresh = false): Promise<void> => {
    setState(s => ({ ...s, loading: true }));
    try {
      const url = refresh ? '/api/sessions?refresh=true' : '/api/sessions';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const sessions = (await res.json()) as Session[];
      // Add UI-only fields the design expects but the API doesn't currently send:
      // toolResultSizeBytes split + secret count are placeholders until detail loads.
      const enriched = sessions.map(s => ({
        ...s,
        toolResultSizeBytes: Math.round((s.totalSizeBytes - s.imageSizeBytes) * (s.imageCount > 0 ? 0.55 : 0.82)),
        textSizeBytes: Math.round((s.totalSizeBytes - s.imageSizeBytes) * (s.imageCount > 0 ? 0.45 : 0.18)),
        secretCount: 0,
        maxSeverity: null,
      } as Session & { toolResultSizeBytes: number; textSizeBytes: number; secretCount: number; maxSeverity: string | null }));
      setState({ sessions: enriched, loading: false, error: null });
    } catch (err) {
      setState({ sessions: [], loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => { void fetchSessions(); }, [fetchSessions]);

  return { ...state, refresh: () => fetchSessions(true) };
}
