import { sevColor } from '../lib/format';

export function SevPill({ sev, count }: { sev: 'high' | 'medium' | 'low'; count?: number }) {
  return (
    <span className="sevpill" style={{ '--sv': sevColor(sev) } as React.CSSProperties}>
      <span className="sevpill-dot" />
      {count != null ? count : ''} {sev}
    </span>
  );
}
