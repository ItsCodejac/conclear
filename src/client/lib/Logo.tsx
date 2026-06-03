/**
 * ConClear brand mark — a "console block being cleared".
 * Stacked data bars + sweep line. Geometric, reads at any size.
 */
export function Logo({ size = 28, mono = false }: { size?: number; mono?: boolean }) {
  const a = mono ? 'currentColor' : 'var(--accent)';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="29" height="29" rx="8" fill="var(--accent-dim)" stroke={a} strokeWidth="1.5" />
      <rect x="8" y="9.5" width="16" height="2.6" rx="1.3" fill={a} />
      <rect x="8" y="14.7" width="11" height="2.6" rx="1.3" fill={a} opacity="0.62" />
      <rect x="8" y="19.9" width="6.5" height="2.6" rx="1.3" fill={a} opacity="0.3" />
      <path d="M5 24.5 L27 18.2" stroke={a} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
