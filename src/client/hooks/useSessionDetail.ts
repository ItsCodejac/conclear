import { useEffect, useState } from 'react';
import type {
  SessionDetail, ParsedConversation, FileHistory, SecretFinding,
} from '../lib/types';

interface State<T> { data: T | null; loading: boolean; error: string | null }

function useApi<T>(url: string | null): State<T> {
  const [state, setState] = useState<State<T>>({ data: null, loading: false, error: null });
  useEffect(() => {
    if (!url) { setState({ data: null, loading: false, error: null }); return; }
    let cancelled = false;
    setState({ data: null, loading: true, error: null });
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as T;
        if (!cancelled) setState({ data, loading: false, error: null });
      } catch (err) {
        if (!cancelled) setState({ data: null, loading: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [url]);
  return state;
}

export function useSessionDetail(id: string | null) {
  return useApi<SessionDetail>(id ? `/api/sessions/${encodeURIComponent(id)}` : null);
}
export function useConversation(id: string | null) {
  return useApi<ParsedConversation>(id ? `/api/sessions/${encodeURIComponent(id)}/conversation` : null);
}
export function useFileHistory(id: string | null) {
  return useApi<FileHistory[]>(id ? `/api/sessions/${encodeURIComponent(id)}/files` : null);
}
export function useScan(id: string | null) {
  return useApi<SecretFinding[]>(id ? `/api/sessions/${encodeURIComponent(id)}/scan` : null);
}
