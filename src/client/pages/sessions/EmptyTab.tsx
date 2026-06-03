import { Icon } from '../../lib/icons';

export function EmptyTab({ icon, title, sub }: {
  icon: Parameters<typeof Icon>[0]['name'];
  title: string;
  sub: string;
}) {
  return (
    <div className="empty-state">
      <div className="es-ico"><Icon name={icon} size={26} /></div>
      <div className="es-title">{title}</div>
      <div style={{ maxWidth: 360 }}>{sub}</div>
    </div>
  );
}
