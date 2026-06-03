import { useState } from 'react';
import { Icon } from '../../lib/icons';
import { clsx, fmtBytes, fmtNum } from '../../lib/format';
import { TOOLS, type Session } from '../../lib/types';
import { Btn } from '../../components/Btn';
import { ToolBadge } from '../../components/ToolBadge';
import { useScan } from '../../hooks/useSessionDetail';
import { SummaryTab } from './SummaryTab';
import { ImagesTab } from './ImagesTab';
import { ChatTab } from './ChatTab';
import { TimelineTab } from './TimelineTab';
import { FilesTab } from './FilesTab';
import { SecurityTab } from './SecurityTab';

interface Props {
  session: Session & { toolResultSizeBytes?: number; textSizeBytes?: number };
  onClose: () => void;
  toast: (type: 'success' | 'error', msg: string) => void;
}

type TabId = 'summary' | 'images' | 'chat' | 'timeline' | 'files' | 'security';

function healthColor(s: Session & { secretCount?: number; maxSeverity?: string | null }): string {
  if ((s.secretCount ?? 0) > 0 && s.maxSeverity === 'high') return 'var(--danger)';
  if (s.hasOversizedImages) return 'var(--warn)';
  if ((s.secretCount ?? 0) > 0) return 'var(--warn)';
  return 'var(--accent)';
}

export function SessionDetail({ session, onClose, toast }: Props) {
  const caps = TOOLS[session.tool].caps;
  const scan = useScan(caps.scanSecrets ? session.id : null);
  const secretCount = scan.data?.length ?? 0;

  const tabs: Array<{ id: TabId; label: string; icon: Parameters<typeof Icon>[0]['name']; count?: number; cap?: keyof typeof caps; alert?: boolean }> = [
    { id: 'summary',  label: 'Summary',  icon: 'sparkle' },
    { id: 'images',   label: 'Images',   icon: 'image',   count: session.imageCount },
    { id: 'chat',     label: 'Chat',     icon: 'chat',    count: session.messageCount },
    { id: 'timeline', label: 'Timeline', icon: 'timeline' },
    { id: 'files',    label: 'Files',    icon: 'file',    cap: 'fileHistory' },
    { id: 'security', label: 'Security', icon: 'shield',  cap: 'scanSecrets', alert: secretCount > 0 },
  ];

  const [tab, setTab] = useState<TabId>('summary');

  return (
    <div className="detail">
      <div className="detail-head">
        <div className="dh-top">
          <div style={{ minWidth: 0 }}>
            <h2 className="dh-title">
              <span className="srow-health" style={{ background: healthColor(session as any), width: 10, height: 10 }} />
              {session.name ?? session.preview ?? session.id}
            </h2>
            <div className="dh-sub">
              <ToolBadge tool={session.tool} size="lg" />
              <span>{session.project}</span>
              <span className="dot-sep">·</span>
              <span className="mono">{session.messageCount} messages</span>
              <span className="dot-sep">·</span>
              <span className="mono">{session.imageCount} images</span>
              <span className="dot-sep">·</span>
              <span className="mono sz">{fmtBytes(session.totalSizeBytes)}</span>
            </div>
          </div>
          <div className="dh-actions">
            <Btn icon="copy" variant="ghost" size="sm" title="Copy resume command"
              onClick={() => {
                void navigator.clipboard.writeText(`${session.tool} --resume "${session.name ?? session.id}"`);
                toast('success', `Copied resume command`);
              }} />
            {caps.exportSession && (
              <Btn icon="download" variant="ghost" size="sm" title="Export markdown"
                onClick={() => {
                  window.open(`/api/sessions/${encodeURIComponent(session.id)}/export`, '_blank');
                }} />
            )}
            <Btn icon="close" variant="ghost" size="sm" onClick={onClose} />
          </div>
        </div>

        {session.usage?.totalCostUsd != null && (
          <div className="dh-sub" style={{ marginTop: 8 }}>
            <span className="tag">
              <Icon name="coin" size={11} style={{ verticalAlign: -1 }} /> ${session.usage.totalCostUsd.toFixed(2)}
            </span>
            <span className="tag">{fmtNum(session.usage.tokensIn ?? 0)} in</span>
            <span className="tag">{fmtNum(session.usage.tokensOut ?? 0)} out</span>
            {session.usage.cacheReads && session.usage.cacheReads > 0 && (
              <span className="tag">{fmtNum(session.usage.cacheReads)} cache</span>
            )}
          </div>
        )}

        <div className="tabs">
          {tabs.map(t => {
            const disabled = t.cap ? !caps[t.cap] : false;
            return (
              <button
                key={t.id}
                className={clsx('tab', tab === t.id && 'active', t.id === 'security' && 'warn-tab')}
                disabled={disabled}
                title={disabled ? `${TOOLS[session.tool].label} does not support this` : undefined}
                onClick={() => setTab(t.id)}
                style={disabled ? { opacity: 0.35, cursor: 'not-allowed' } : undefined}
              >
                <Icon name={t.icon} size={14} />{t.label}
                {t.count != null && <span className="tab-count">{t.count}</span>}
                {t.alert && <span className="tab-alert" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="detail-body">
        {tab === 'summary'  && <SummaryTab  session={session} caps={caps} onTab={setTab as (t: string) => void} />}
        {tab === 'images'   && <ImagesTab   session={session} caps={caps} toast={toast} />}
        {tab === 'chat'     && <ChatTab     session={session} />}
        {tab === 'timeline' && <TimelineTab session={session} />}
        {tab === 'files'    && <FilesTab    session={session} toast={toast} />}
        {tab === 'security' && <SecurityTab session={session} toast={toast} />}
      </div>
    </div>
  );
}
