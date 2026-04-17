import { ResizeMenu } from '../ResizeMenu';
import styles from './styles.module.css';

interface ToolbarProps {
  onRefresh: () => void;
  onStripAll?: () => void;
  onResizeAll?: (targetBytes: number) => void;
  onClearStripped?: () => void;
  onShowBackups: () => void;
  onExport?: () => void;
  strippedCount: number;
  sessionName: string | null;
  operating?: string | null;
}

export function Toolbar({ onRefresh, onStripAll, onResizeAll, onClearStripped, onShowBackups, onExport, strippedCount, sessionName, operating }: ToolbarProps) {
  const busy = !!operating;

  return (
    <div className={styles.toolbar}>
      <button className={styles.btn} onClick={onRefresh} disabled={busy}>
        Refresh
      </button>
      {onResizeAll && (
        <ResizeMenu onResize={onResizeAll} label="Resize All" disabled={busy} />
      )}
      {onStripAll && (
        <button className={styles.btnDanger} onClick={onStripAll} disabled={busy}>
          Strip All
        </button>
      )}
      {onClearStripped && (
        <button className={styles.btnClear} onClick={onClearStripped} disabled={busy}>
          Clear {strippedCount} stripped
        </button>
      )}
      {onExport && (
        <button className={styles.btn} onClick={onExport} disabled={busy}>
          Export
        </button>
      )}
      {operating && (
        <span className={styles.progressIndicator}>{operating}</span>
      )}
      <div className={styles.spacer} />
      <button className={styles.btn} onClick={onShowBackups} disabled={busy}>
        Backups
      </button>
      {sessionName && (
        <span className={styles.sessionLabel}>{sessionName}</span>
      )}
    </div>
  );
}
