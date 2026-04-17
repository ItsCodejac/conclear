import { useMemo } from 'react';
import { decodeProjectName } from '../../utils';
import type { Session } from '../../types';
import styles from './styles.module.css';

interface DiskUsageProps {
  sessions: Session[];
  onSelect: (id: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface ProjectStats {
  project: string;
  totalSize: number;
  imageCount: number;
}

export function DiskUsage({ sessions, onSelect }: DiskUsageProps) {
  const totalSize = useMemo(
    () => sessions.reduce((s, x) => s + x.totalSizeBytes, 0),
    [sessions],
  );
  const totalImages = useMemo(
    () => sessions.reduce((s, x) => s + x.imageCount, 0),
    [sessions],
  );
  const totalImageBytes = useMemo(
    () => sessions.reduce((s, x) => s + x.imageSizeBytes, 0),
    [sessions],
  );

  const projectStats = useMemo(() => {
    const map = new Map<string, ProjectStats>();
    for (const s of sessions) {
      const existing = map.get(s.project);
      if (existing) {
        existing.totalSize += s.totalSizeBytes;
        existing.imageCount += s.imageCount;
      } else {
        map.set(s.project, {
          project: s.project,
          totalSize: s.totalSizeBytes,
          imageCount: s.imageCount,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalSize - a.totalSize);
  }, [sessions]);

  const maxProjectSize = projectStats.length > 0 ? projectStats[0].totalSize : 1;

  const problemSessions = useMemo(
    () =>
      sessions
        .filter((s) => s.hasOversizedImages)
        .sort((a, b) => b.maxImageDimension - a.maxImageDimension),
    [sessions],
  );

  const topOffenders = useMemo(
    () =>
      [...sessions]
        .sort((a, b) => b.imageSizeBytes - a.imageSizeBytes)
        .filter((s) => s.imageSizeBytes > 0)
        .slice(0, 5),
    [sessions],
  );

  const otherBytes = totalSize - totalImageBytes;
  const imagePct = totalSize > 0 ? (totalImageBytes / totalSize) * 100 : 0;
  const otherPct = totalSize > 0 ? (otherBytes / totalSize) * 100 : 0;

  return (
    <div className={styles.container}>
      {/* Total disk usage */}
      <div className={styles.section}>
        <h3 className={styles.heading}>Total Disk Usage</h3>
        <p className={styles.totalSize}>{formatBytes(totalSize)}</p>
        <p className={styles.totalSub}>
          {sessions.length} sessions &middot; {totalImages} images
        </p>
      </div>

      {/* Breakdown by project */}
      <div className={styles.section}>
        <h3 className={styles.heading}>By Project</h3>
        {projectStats.map((p) => {
          const pct = maxProjectSize > 0 ? (p.totalSize / maxProjectSize) * 100 : 0;
          return (
            <div className={styles.barRow} key={p.project}>
              <span className={styles.barLabel} title={decodeProjectName(p.project)}>
                {decodeProjectName(p.project)}
              </span>
              <div className={styles.barTrack}>
                <div className={styles.barFill} style={{ width: `${pct}%` }} />
              </div>
              <span className={styles.barMeta}>
                {formatBytes(p.totalSize)} &middot; {p.imageCount} img
              </span>
            </div>
          );
        })}
      </div>

      {/* Image data vs other */}
      <div className={styles.section}>
        <h3 className={styles.heading}>Image Data vs Other</h3>
        <div className={styles.segmentBar}>
          <div className={styles.segmentImage} style={{ width: `${imagePct}%` }} />
          <div className={styles.segmentOther} style={{ width: `${otherPct}%` }} />
        </div>
        <div className={styles.segmentLegend}>
          <span className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: '#f59e0b' }} />
            <span className={styles.legendLabel}>Images</span>
            <span className={styles.legendValue}>{formatBytes(totalImageBytes)} ({imagePct.toFixed(1)}%)</span>
          </span>
          <span className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: '#3f3f46' }} />
            <span className={styles.legendLabel}>Other</span>
            <span className={styles.legendValue}>{formatBytes(otherBytes)} ({otherPct.toFixed(1)}%)</span>
          </span>
        </div>
      </div>

      {/* Problem sessions — oversized images that trigger dimension warnings */}
      {problemSessions.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.heading}>Problem Sessions (Oversized Images)</h3>
          <p className={styles.problemDesc}>
            These sessions have multiple images with dimensions &gt;2000px, which may trigger Claude Code&apos;s image dimension limit warning.
          </p>
          {problemSessions.map((s) => (
            <div
              key={s.id}
              className={styles.offenderRow}
              onClick={() => onSelect(s.id)}
            >
              <span className={styles.problemIcon}>&#x26A0;</span>
              <span className={styles.offenderName} title={s.name ?? s.preview ?? s.id}>
                {s.name ?? s.preview ?? s.id}
              </span>
              <span className={styles.problemDim}>{s.maxImageDimension}px</span>
              <span className={styles.offenderImages}>{s.imageCount} img</span>
            </div>
          ))}
        </div>
      )}

      {/* Top offenders */}
      {topOffenders.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.heading}>Top Offenders (Image Data)</h3>
          {topOffenders.map((s, i) => (
            <div
              key={s.id}
              className={styles.offenderRow}
              onClick={() => onSelect(s.id)}
            >
              <span className={styles.offenderRank}>{i + 1}</span>
              <span className={styles.offenderName} title={s.name ?? s.preview ?? s.id}>
                {s.name ?? s.preview ?? s.id}
              </span>
              <span className={styles.offenderSize}>{formatBytes(s.imageSizeBytes)}</span>
              <span className={styles.offenderImages}>{s.imageCount} img</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
