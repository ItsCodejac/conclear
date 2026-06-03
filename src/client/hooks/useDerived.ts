import { useMemo } from 'react';
import { MB } from '../lib/format';
import type { Session } from '../lib/types';

interface ProjectGroup { key: string; size: number; imageBytes: number; images: number; count: number }

/** Same derivations used in the Reclaim/Overview page. Lives outside so the
 * titlebar can use the total figure without re-mounting Overview. */
export function useDerived(sessions: Session[]) {
  return useMemo(() => {
    const totalSize = sessions.reduce((s, x) => s + x.totalSizeBytes, 0);
    const totalImageBytes = sessions.reduce((s, x) => s + x.imageSizeBytes, 0);
    const totalImages = sessions.reduce((s, x) => s + x.imageCount, 0);

    // tool-result and text bytes are computed in useSessions for UI continuity
    const totalToolResult = sessions.reduce((s, x) => s + ((x as any).toolResultSizeBytes ?? 0), 0);
    const totalText = sessions.reduce((s, x) => s + ((x as any).textSizeBytes ?? 0), 0);

    const bloated = sessions
      .filter(s => s.totalSizeBytes > 15 * MB && (s.imageSizeBytes / s.totalSizeBytes) < 0.25)
      .sort((a, b) => ((b as any).toolResultSizeBytes ?? 0) - ((a as any).toolResultSizeBytes ?? 0));
    const problem = sessions
      .filter(s => s.hasOversizedImages)
      .sort((a, b) => b.maxImageDimension - a.maxImageDimension);
    const offenders = [...sessions]
      .filter(s => s.imageSizeBytes > 0)
      .sort((a, b) => b.imageSizeBytes - a.imageSizeBytes)
      .slice(0, 6);

    const secretSessions = sessions.filter(s => ((s as any).secretCount ?? 0) > 0);
    const totalSecrets = secretSessions.reduce((s, x) => s + (((x as any).secretCount ?? 0) as number), 0);

    const groupBy = (key: 'project' | 'tool'): ProjectGroup[] => {
      const m = new Map<string, ProjectGroup>();
      for (const s of sessions) {
        const k = s[key];
        const e = m.get(k) || { key: k, size: 0, imageBytes: 0, images: 0, count: 0 };
        e.size += s.totalSizeBytes;
        e.imageBytes += s.imageSizeBytes;
        e.images += s.imageCount;
        e.count++;
        m.set(k, e);
      }
      return [...m.values()].sort((a, b) => b.size - a.size);
    };

    return {
      totalSize, totalImageBytes, totalImages, totalToolResult, totalText,
      problem, offenders, secretSessions, totalSecrets,
      byProject: groupBy('project'), byTool: groupBy('tool'),
      bloated,
    };
  }, [sessions]);
}
