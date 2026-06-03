import { useEffect, useState, useCallback } from 'react';
import type { BackupItem } from '../lib/types';

export function useBackups() {
  const [items, setItems] = useState<BackupItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/backups');
      if (res.ok) setItems((await res.json()) as BackupItem[]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const deleteOne = useCallback(async (name: string) => {
    await fetch(`/api/backups/${encodeURIComponent(name)}`, { method: 'DELETE' });
    setItems(prev => prev.filter(b => b.name !== name));
  }, []);

  const deleteAll = useCallback(async () => {
    await fetch('/api/backups', { method: 'DELETE' });
    setItems([]);
  }, []);

  return { items, loading, refresh, deleteOne, deleteAll };
}
