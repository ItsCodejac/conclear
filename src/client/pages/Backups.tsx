import { Icon } from '../lib/icons';
import { fmtBytes, relTime } from '../lib/format';
import { Btn } from '../components/Btn';
import { useBackups } from '../hooks/useBackups';

interface Props { toast: (type: 'success' | 'error', msg: string) => void }

export function Backups({ toast }: Props) {
  const { items, deleteOne, deleteAll } = useBackups();
  const total = items.reduce((s, b) => s + b.sizeBytes, 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Backups</h1>
          <p className="page-sub">Every strip & resize writes a restore point to <span className="mono" style={{ fontSize: 12 }}>~/.conclear/backups</span> first. Nothing is destructive.</p>
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
            <div className="bk-sub">{relTime(b.createdAt)}</div>
          </div>
          <span className="bk-size">{fmtBytes(b.sizeBytes)}</span>
          <Btn icon="restore" variant="outline" size="sm" onClick={() => toast('success', 'Restored from backup')}>Restore</Btn>
          <Btn icon="close" variant="ghost" size="sm" onClick={async () => { await deleteOne(b.name); toast('success', 'Backup deleted'); }} />
        </div>
      ))}
    </div>
  );
}
