import { useCallback, useState } from 'react';

export interface Toast {
  id: number;
  type: 'success' | 'error';
  msg: string;
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((type: 'success' | 'error', msg: string) => {
    const id = Math.random();
    setToasts(p => [...p, { id, type, msg }]);
    setTimeout(() => setToasts(p => p.filter(x => x.id !== id)), 3200);
  }, []);

  return { toasts, toast };
}
