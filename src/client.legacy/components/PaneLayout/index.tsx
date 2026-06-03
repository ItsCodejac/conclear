import { type ReactNode, useCallback, useRef, useState, useEffect } from 'react';
import styles from './styles.module.css';

interface PaneLayoutProps {
  left: ReactNode;
  right: ReactNode;
}

export function PaneLayout({ left, right }: PaneLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rightWidth, setRightWidth] = useState(380);
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newRight = rect.right - e.clientX;
      setRightWidth(Math.max(240, Math.min(newRight, rect.width - 300)));
    };

    const onMouseUp = () => {
      if (dragging.current) {
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return (
    <div className={styles.layout} ref={containerRef}>
      <div className={styles.left}>{left}</div>
      <div className={styles.divider} onMouseDown={onMouseDown} />
      <div className={styles.right} style={{ width: rightWidth }}>{right}</div>
    </div>
  );
}
