import { useEffect, useState } from 'react';
import { Icon } from '../../lib/icons';
import { clsx, fmtBytes } from '../../lib/format';
import type { Session, FileVersion } from '../../lib/types';
import { Btn } from '../../components/Btn';
import { CodeViewer } from '../../extras/CodeViewer';
import { useFileHistory } from '../../hooks/useSessionDetail';
import { EmptyTab } from './EmptyTab';

interface Props {
  session: Session;
  toast: (type: 'success' | 'error', msg: string) => void;
}

function useFileContent(sessionId: string, lineNumber: number | null) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (lineNumber == null) { setContent(null); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/files/${lineNumber}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { content: string };
        if (!cancelled) setContent(data.content);
      } catch {
        if (!cancelled) setContent(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, lineNumber]);
  return { content, loading };
}

function VersionOpen({ session, version, toast }: { session: Session; version: FileVersion; toast: Props['toast'] }) {
  const { content, loading } = useFileContent(session.id, version.lineNumber);
  if (loading) return <div className="vstat" style={{ padding: '8px 2px' }}>Loading…</div>;
  if (!content) return <div className="vstat" style={{ padding: '8px 2px' }}>Could not load this version.</div>;
  return <CodeViewer code={content} path={version.filePath} onCopy={() => toast('success', 'Code copied')} />;
}

export function FilesTab({ session, toast }: Props) {
  const fh = useFileHistory(session.id);
  const [open, setOpen] = useState<string | null>(null);

  if (fh.loading) return <EmptyTab icon="file" title="Loading file history…" sub="Reading file versions from the session." />;
  const files = fh.data ?? [];
  if (files.length === 0) {
    return <EmptyTab icon="file" title="No file history" sub="Either this tool doesn't expose file edits, or the session contained no file ops." />;
  }

  return (
    <div className="files-layout">
      {files.map(f => (
        <div className="card filecard" key={f.filePath}>
          <div className="filecard-head">
            <Icon name="file" size={16} style={{ color: 'var(--muted2)' }} />
            <span className="fc-path">{f.filePath}</span>
            <span className="fc-meta">{f.versions.length} versions</span>
          </div>
          {f.versions.map((v, i) => {
            const key = `${f.filePath}#${i}`;
            const isOpen = open === key;
            return (
              <div key={i}>
                <div className="ver-row" onClick={() => setOpen(isOpen ? null : key)}>
                  <span className="vtime">{v.timestamp ?? '—'}</span>
                  <span className={clsx('vop', v.operation)}>{v.operation}</span>
                  <span className="vpreview">{v.contentPreview}</span>
                  <span className="vstat">{v.lineCount}L · {fmtBytes(v.sizeBytes)}</span>
                  <Btn icon={isOpen ? 'chevronD' : 'chevron'} variant="ghost" size="sm" />
                </div>
                {isOpen && (
                  <div style={{ margin: '4px 0 10px' }}>
                    <VersionOpen session={session} version={v} toast={toast} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
