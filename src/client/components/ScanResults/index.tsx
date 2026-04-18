import { useState, useEffect, useCallback } from 'react';
import type { SecretFinding } from '../../types';
import styles from './styles.module.css';

interface ScanResultsProps {
  visible: boolean;
  sessionId: string | null;
  onClose: () => void;
}

export function ScanResults({ visible, sessionId, onClose }: ScanResultsProps) {
  const [findings, setFindings] = useState<SecretFinding[]>([]);
  const [loading, setLoading] = useState(false);

  const runScan = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/scan`);
      const data = await res.json();
      setFindings(data);
    } catch {
      setFindings([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (visible && sessionId) runScan();
  }, [visible, sessionId, runScan]);

  if (!visible) return null;

  const high = findings.filter(f => f.severity === 'high').length;
  const medium = findings.filter(f => f.severity === 'medium').length;
  const low = findings.filter(f => f.severity === 'low').length;

  const badgeClass = (severity: string) => {
    if (severity === 'high') return styles.badgeHigh;
    if (severity === 'medium') return styles.badgeMedium;
    return styles.badgeLow;
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Secret Scan</span>
          {!loading && findings.length > 0 && (
            <span className={styles.summary}>
              {high} high, {medium} medium, {low} low findings
            </span>
          )}
          <div className={styles.spacer} />
          <button className={styles.closeBtn} onClick={onClose}>ESC</button>
        </div>

        <div className={styles.content}>
          {loading ? (
            <div className={styles.loading}>Scanning...</div>
          ) : findings.length === 0 ? (
            <div className={styles.noFindings}>No secrets detected</div>
          ) : (
            findings.map((f, i) => (
              <div key={i} className={styles.finding}>
                <span className={badgeClass(f.severity)}>{f.severity}</span>
                <div className={styles.findingBody}>
                  <div>
                    <span className={styles.findingType}>{f.type}</span>
                    <span className={styles.findingLine}>line {f.lineNumber}</span>
                  </div>
                  <div className={styles.findingPattern}>{f.pattern}</div>
                  <div className={styles.findingContext}>{f.context}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
