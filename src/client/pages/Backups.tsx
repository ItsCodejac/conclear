import { Icon } from '../lib/icons';
import { fmtBytes, relTime } from '../lib/format';
import { Btn } from '../components/Btn';
import { useBackups } from '../hooks/useBackups';

interface Props { toast: (type: 'success' | 'error', msg: string) => void }

const ACTION_LABEL: Record<string, string> = {
  strip: 'image strip',
  resize: 'image resize',
  redact: 'secret redact',
  mutate: 'edit',
};

export function Backups({ toast }: Props) {
  const { items, deleteOne, deleteAll, restore, refresh } = useBackups();
  const total = items.reduce((s, b) => s + b.sizeBytes, 0);

  async function onRestore(name: string) {
    const r = await restore(name);
    if (r.ok) {
      toast('success', `Restored to ${r.restoredTo ?? 'original location'}`);
      await refresh();
    } else {
      toast('error', r.error ?? 'Restore failed');
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Backups</h1>
          <p className="page-sub">Every strip, resize, and redact writes a restore point to <span className="mono" style={{ fontSize: 12 }}>~/.conclear/backups</span> first. Nothing is destructive.</p>
        </div>
        <div className="page-actions">
          <Btn icon="archive" variant="ghost">{fmtBytes(total)} stored</Btn>
          {items.length > 0 && (
            <Btn icon="scissors" danger onClick={async () => { await deleteAll(); toast('success', 'All backups deleted'); }}>Delete all</Btn>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <div className="es-ico"><Icon name="archive" size={26} /></div>
          <div className="es-title">No backups yet</div>
          <div>Restore points appear here after you clean a session.</div>
        </div>
      ) : items.map(b => (
        <div className="bk-row" key={b.name}>
          <span className="bk-ico"><Icon name="archive" size={17} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="bk-name">{b.name}</div>
            <div className="bk-sub">
              {relTime(b.createdAt)}
              {b.action && <> · <span className="tag">{ACTION_LABEL[b.action] ?? b.action}</span></>}
              {b.origPath && <> · <span className="mono" style={{ fontSize: 11, opacity: 0.7 }}>{b.origPath}</span></>}
            </div>
          </div>
          <span className="bk-size">{fmtBytes(b.sizeBytes)}</span>
          <Btn
            icon="restore"
            variant="outline"
            size="sm"
            disabled={!b.canRestore}
            title={b.canRestore ? 'Copy this backup over the original session file' : 'Legacy backup (pre-0.3.2) — no restore target recorded'}
            onClick={() => void onRestore(b.name)}
          >
            Restore
          </Btn>
          <Btn icon="close" variant="ghost" size="sm" onClick={async () => { await deleteOne(b.name); toast('success', 'Backup deleted'); }} />
        </div>
      ))}
    </div>
  );
}
