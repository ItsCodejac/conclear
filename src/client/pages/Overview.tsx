import { Icon } from '../lib/icons';
import { Logo } from '../lib/Logo';
import { fmtBytes, MB } from '../lib/format';
import type { Session } from '../lib/types';
import { Btn } from '../components/Btn';
import { Meter } from '../components/Meter';
import { SegBar } from '../components/SegBar';
import { ToolBadge } from '../components/ToolBadge';
import { useDerived } from '../hooks/useDerived';

interface Props {
  sessions: Session[];
  onOpen: (id: string) => void;
  onGoto: (project?: string) => void;
  onClean: () => void;
  onRescan: () => void;
}

function pctColor(p: number): string {
  return p > 60 ? 'var(--danger)' : p > 25 ? 'var(--warn)' : 'var(--muted)';
}
function szClass(b: number, big: number): string {
  return b >= big ? 'sz sz-hot' : b >= big / 3 ? 'sz sz-warm' : 'sz sz-cool';
}

export function Overview({ sessions, onOpen, onGoto, onClean, onRescan }: Props) {
  const d = useDerived(sessions);
  const reclaimPct = d.totalSize > 0 ? (d.totalImageBytes / d.totalSize) * 100 : 0;
  const maxProj = d.byProject[0]?.size || 1;
  const maxTool = d.byTool[0]?.size || 1;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Reclaim</h1>
          <p className="page-sub">{sessions.length} sessions across {d.byProject.length} projects · scanned just now</p>
        </div>
        <div className="page-actions">
          <Btn icon="refresh" variant="ghost" onClick={onRescan}>Rescan</Btn>
        </div>
      </div>

      {/* hero */}
      <div className="hero">
        <div className="hero-main">
          <div className="hero-eyebrow">Total session data on disk</div>
          <div className="hero-big">
            <span className="v">{(d.totalSize / MB).toFixed(0)}</span>
            <span className="u">MB</span>
          </div>
          <div className="hero-reclaim">
            <b>{fmtBytes(d.totalImageBytes)}</b> is image data — recoverable by stripping or resizing screenshots.
          </div>
          <div className="hero-actions">
            <Btn icon="bolt" variant="primary" size="lg" onClick={onClean}>
              Clean {d.problem.length} problem sessions
            </Btn>
            <Btn icon="image" variant="outline" onClick={() => onGoto()}>Review images</Btn>
          </div>
          <div className="hero-spark"><Logo size={150} /></div>
        </div>

        <div className="hero-side">
          <div className="card statcard">
            <div className="s-label"><Icon name="image" size={14} /> Image vs other</div>
            <div className="s-val reclaim-num">
              {reclaimPct.toFixed(0)}
              <span style={{ fontSize: 18, color: 'var(--muted)' }}>%</span>
            </div>
            <div className="mt-2" style={{ width: '100%' }}>
              <SegBar h={9} segments={[
                { value: d.totalImageBytes, color: 'var(--accent)', label: 'Images' },
                { value: d.totalSize - d.totalImageBytes, color: 'var(--surface-3)', label: 'Other' },
              ]} />
            </div>
            <div className="s-sub">{fmtBytes(d.totalImageBytes)} images · {fmtBytes(d.totalSize - d.totalImageBytes)} other</div>
          </div>
          <div className="card statcard dangerstat">
            <div className="s-label"><Icon name="shield" size={14} /> Needs attention</div>
            <div className="s-val">{d.problem.length + d.secretSessions.length}</div>
            <div className="s-sub">{d.problem.length} oversized · {d.totalSecrets} secrets in {d.secretSessions.length} sessions</div>
          </div>
        </div>
      </div>

      {/* breakdowns */}
      <div className="grid-2" style={{ marginBottom: 'var(--gap)' }}>
        <div className="card panel">
          <div className="panel-head">
            <div className="panel-title"><Icon name="grid" size={15} className="pt-ico" /> Where space goes</div>
            <span className="panel-link" onClick={() => onGoto()}>
              By project <Icon name="chevron" size={12} />
            </span>
          </div>
          <div className="olist">
            {d.byProject.slice(0, 6).map(p => (
              <div className="barrow" key={p.key} onClick={() => onGoto(p.key)}>
                <span className="barrow-label" title={p.key}>{p.key}</span>
                <Meter value={p.size} max={maxProj} color={pctColor((p.imageBytes / Math.max(p.size, 1)) * 100)} />
                <span className="barrow-meta">{fmtBytes(p.size)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card panel">
          <div className="panel-head">
            <div className="panel-title"><Icon name="cpu" size={15} className="pt-ico" /> By tool</div>
            <span className="pg-meta">{d.byTool.length} detected</span>
          </div>
          <div className="olist">
            {d.byTool.map(t => (
              <div className="barrow" key={t.key}>
                <span className="barrow-label"><ToolBadge tool={t.key as any} /></span>
                <Meter value={t.size} max={maxTool} color="var(--accent)" />
                <span className="barrow-meta">{fmtBytes(t.size)} · {t.count}s</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* problem + offenders */}
      <div className="grid-2">
        <div className="card panel">
          <div className="panel-head">
            <div className="panel-title">
              <Icon name="warn" size={15} className="pt-ico" style={{ color: 'var(--warn)' }} /> Problem sessions
            </div>
            <span className="pg-meta">images &gt; 2000px</span>
          </div>
          <p className="page-sub" style={{ margin: '0 0 10px' }}>
            These trigger Claude Code's image-dimension limit. Resize to fix without losing context.
          </p>
          <div className="olist">
            {d.problem.length === 0
              ? <div style={{ padding: '10px 8px', fontSize: 13, color: 'var(--muted2)' }}>No oversized images detected.</div>
              : d.problem.map(s => (
                <div className="orow" key={s.id} onClick={() => onOpen(s.id)}>
                  <span className="owarn"><Icon name="warn" size={15} /></span>
                  <span className="oname">{s.name ?? s.preview} <span className="op">· {s.project}</span></span>
                  <span className="odim">{s.maxImageDimension}px</span>
                  <span className="ocount">{s.imageCount} img</span>
                </div>
              ))}
          </div>
        </div>

        <div className="card panel">
          <div className="panel-head">
            <div className="panel-title"><Icon name="image" size={15} className="pt-ico" /> Top offenders</div>
            <span className="pg-meta">by image data</span>
          </div>
          <p className="page-sub" style={{ margin: '0 0 10px' }}>Sessions holding the most reclaimable image bytes.</p>
          <div className="olist">
            {d.offenders.map((s, i) => (
              <div className="orow" key={s.id} onClick={() => onOpen(s.id)}>
                <span className="orank">{i + 1}</span>
                <span className="oname">{s.name ?? s.preview} <span className="op">· {s.project}</span></span>
                <span className={szClass(s.imageSizeBytes, 10 * MB)}>{fmtBytes(s.imageSizeBytes)}</span>
                <span className="ocount">{s.imageCount} img</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* storage composition */}
      <div className="card panel" style={{ marginTop: 'var(--gap)' }}>
        <div className="panel-head">
          <div className="panel-title"><Icon name="grid" size={15} className="pt-ico" /> Storage composition</div>
          <span className="pg-meta">what cleanup can &amp; can't reach</span>
        </div>
        <SegBar h={12} segments={[
          { value: d.totalImageBytes, color: 'var(--accent)', label: 'Images' },
          { value: d.totalToolResult, color: 'var(--warn)', label: 'Tool results' },
          { value: d.totalText, color: 'var(--surface-3)', label: 'Text' },
        ]} />
        <div className="bloat-legend">
          <span className="bloat-leg"><span className="sw" style={{ background: 'var(--accent)' }} /> Images <b>{fmtBytes(d.totalImageBytes)}</b> · strip / resize</span>
          <span className="bloat-leg"><span className="sw" style={{ background: 'var(--warn)' }} /> Tool results <b>{fmtBytes(d.totalToolResult)}</b> · not image-cleanable</span>
          <span className="bloat-leg"><span className="sw" style={{ background: 'var(--surface-3)' }} /> Text <b>{fmtBytes(d.totalText)}</b></span>
        </div>
        {d.bloated.length > 0 && (
          <>
            <div className="divider" />
            <p className="page-sub" style={{ margin: '0 0 8px' }}>
              Big from <b style={{ color: 'var(--warn)' }}>tool-result bloat</b>, not images — image cleanup won't shrink these. Resume fresh or archive.
            </p>
            <div className="olist">
              {d.bloated.slice(0, 4).map(s => (
                <div className="orow" key={s.id} onClick={() => onOpen(s.id)}>
                  <span className="owarn" style={{ color: 'var(--warn)' }}><Icon name="bash" size={14} /></span>
                  <span className="oname">{s.name ?? s.preview} <span className="op">· {s.project}</span></span>
                  <span className="odim" style={{ color: 'var(--muted)' }}>
                    {Math.round((s.imageSizeBytes / s.totalSizeBytes) * 100)}% img
                  </span>
                  <span className="ocount">{fmtBytes(s.totalSizeBytes)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
