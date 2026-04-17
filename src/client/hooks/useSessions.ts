import { useState, useEffect, useCallback } from 'react';
import type { Session } from '../types';

const CACHE_KEY = 'conclear:sessions';

function loadCache(): Session[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // corrupt cache
  }
  return [];
}

function saveCache(sessions: Session[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(sessions));
  } catch {
    // storage full or unavailable
  }
}

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>(loadCache);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSessions(data);
      saveCache(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);

  return { sessions, loading, error, refresh: fetch_ };
}
