export interface Segment { value: number; color: string; label: string }

export function SegBar({ segments, h = 10 }: { segments: Segment[]; h?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="segbar" style={{ height: h }}>
      {segments.map((s, i) => (
        <div
          key={i}
          className="segbar-seg"
          title={s.label}
          style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
        />
      ))}
    </div>
  );
}
