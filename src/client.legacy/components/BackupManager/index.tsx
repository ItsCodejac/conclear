import { useState, useEffect, useCallback } from 'react';
import { formatRelative, decodeProjectName } from '../../utils';
import styles from './styles.module.css';

interface Backup {
  name: string;
  sizeBytes: number;
  createdAt: number;
  path: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const timeAgo = formatRelative;

function formatBackupName(name: string): string {
  // Backup filenames look like: <encoded-project-path>_<uuid>_<timestamp>.jsonl
  // or similar patterns with encoded paths and UUIDs
  try {
    // Strip extension
    const base = name.replace(/\.\w+$/, '');

    // Try to extract a project name from the leading encoded path segment
    // Split on UUID-like patterns (8-4-4-4-12 hex)
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const parts = base.split(uuidPattern);
    const projectRaw = parts[0]?.replace(/_+$/, '') || '';
    const project = projectRaw ? decodeProjectName(projectRaw) : 'session';

    // Try to extract a timestamp from the filename (epoch millis or ISO-like)
    const tsMatch = base.match(/(\d{13})/); // epoch millis
    let dateStr = '';
    if (tsMatch) {
      const d = new Date(parseInt(tsMatch[1], 10));
      if (!isNaN(d.getTime())) {
        dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          + ', ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      }
    }

    return `${project} — backup${dateStr ? ` — ${dateStr}` : ''}`;
  } catch {
    return name;
  }
}

interface BackupManagerProps {
  visible: boolean;
  onClose: () => void;
  onDeleteAll?: () => void;
}

export function BackupManager({ visible, onClose, onDeleteAll }: BackupManagerProps) {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchBackups = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/backups');
      const data = await res.json();
      setBackups(data);
    } catch {
      setBackups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) fetchBackups();
  }, [visible, fetchBackups]);

  const deleteOne = useCallback(async (name: string) => {
    await fetch(`/api/backups/${encodeURIComponent(name)}`, { method: 'DELETE' });
    setBackups(prev => prev.filter(b => b.name !== name));
  }, []);

  const deleteAll = useCallback(async () => {
    await fetch('/api/backups', { method: 'DELETE' });
    setBackups([]);
  }, []);

  if (!visible) return null;

  const totalSize = backups.reduce((s, b) => s + b.sizeBytes, 0);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Backups</span>
          <span className={styles.summary}>
            {backups.length} files / {formatBytes(totalSize)}
          </span>
          <div className={styles.spacer} />
          {backups.length > 0 && (
            <button className={styles.deleteAllBtn} onClick={() => {
              if (onDeleteAll) {
                onDeleteAll();
                onClose();
              } else {
                deleteAll();
              }
            }}>
              Delete all
            </button>
          )}
          <button className={styles.closeBtn} onClick={onClose}>ESC</button>
        </div>

        {loading ? (
          <div className={styles.empty}>Loading...</div>
        ) : backups.length === 0 ? (
          <div className={styles.empty}>No backups</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>File</th>
                <th>Size</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {backups.map(b => (
                <tr key={b.name} className={styles.row}>
                  <td className={styles.nameCell} title={b.name}>{formatBackupName(b.name)}</td>
                  <td className={styles.sizeCell}>{formatBytes(b.sizeBytes)}</td>
                  <td className={styles.timeCell}>{timeAgo(b.createdAt)}</td>
                  <td>
                    <button
                      className={styles.deleteBtn}
                      onClick={() => deleteOne(b.name)}
                    >
                      delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
