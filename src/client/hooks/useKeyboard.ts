import { useEffect } from 'react';

interface KeyboardOptions {
  onRefresh?: () => void;
  onEscape?: () => void;
}

export function useKeyboard({ onRefresh, onEscape }: KeyboardOptions) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault();
        onRefresh?.();
      }
      if (e.key === 'Escape' && onEscape) {
        onEscape();
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onRefresh, onEscape]);
}
