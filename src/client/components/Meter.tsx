export function Meter({ value, max, color = 'var(--accent)', track = 'var(--track)', h = 6 }: {
  value: number; max: number; color?: string; track?: string; h?: number;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="meter" style={{ height: h, background: track }}>
      <div className="meter-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
