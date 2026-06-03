import type { CSSProperties } from 'react';

/**
 * 24×24 stroke icon set, ported verbatim from the design's lib.jsx.
 * Each icon is rendered from minimal path strings, so the set is one
 * compact file rather than 30 SVG components.
 */

type IconName =
  | 'reclaim' | 'sessions' | 'shield' | 'archive' | 'search' | 'image' | 'chat'
  | 'timeline' | 'file' | 'key' | 'warn' | 'close' | 'chevron' | 'chevronD'
  | 'copy' | 'download' | 'scissors' | 'resize' | 'restore' | 'check' | 'bolt'
  | 'cpu' | 'coin' | 'bash' | 'edit' | 'read' | 'write' | 'agent' | 'error'
  | 'user' | 'sparkle' | 'filter' | 'refresh' | 'grid' | 'list' | 'dot'
  | 'arrowDown' | 'gear' | 'org' | 'lock';

interface Props {
  name: IconName;
  size?: number;
  stroke?: number;
  className?: string;
  style?: CSSProperties;
}

const P = (d: string) => <path key={d} d={d} />;

const PATHS: Record<IconName, React.ReactNode> = {
  reclaim:  <>{P('M3 7h18')}{P('M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2')}{P('M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13')}{P('M10 11v6')}{P('M14 11v6')}</>,
  sessions: <>{P('M4 6h16')}{P('M4 12h16')}{P('M4 18h10')}</>,
  shield:   <>{P('M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z')}{P('M9.5 12l1.8 1.8 3.4-3.6')}</>,
  archive:  <>{P('M3 7l1.5-3h15L21 7')}{P('M4 7h16v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7z')}{P('M9.5 11h5')}</>,
  search:   <>{P('M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0')}{P('M20 20l-3.5-3.5')}</>,
  image:    <>{P('M3 5h18v14H3z')}{P('M3 16l5-5 4 4 3-3 6 6')}{P('M8.5 9.5m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0')}</>,
  chat:     <>{P('M4 5h16v11H9l-5 4V5z')}</>,
  timeline: <>{P('M6 4v16')}{P('M6 7h10')}{P('M6 12h13')}{P('M6 17h7')}{P('M16 7m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0')}{P('M19 12m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0')}{P('M13 17m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0')}</>,
  file:     <>{P('M6 3h8l4 4v14H6z')}{P('M14 3v4h4')}{P('M9 13h6')}{P('M9 17h6')}</>,
  key:      <>{P('M14.5 9.5m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0')}{P('M12 12L4 20')}{P('M7 17l2 2')}{P('M5.5 18.5l2 2')}</>,
  warn:     <>{P('M12 4l9 16H3l9-16z')}{P('M12 10v4')}{P('M12 17.5v.01')}</>,
  close:    <>{P('M6 6l12 12')}{P('M18 6L6 18')}</>,
  chevron:  <>{P('M9 6l6 6-6 6')}</>,
  chevronD: <>{P('M6 9l6 6 6-6')}</>,
  copy:     <>{P('M9 9h10v10H9z')}{P('M5 15V5h10')}</>,
  download: <>{P('M12 4v11')}{P('M8 11l4 4 4-4')}{P('M5 19h14')}</>,
  scissors: <>{P('M6 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0')}{P('M6 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0')}{P('M8 8l12 8')}{P('M8 16l12-8')}</>,
  resize:   <>{P('M4 9V4h5')}{P('M20 15v5h-5')}{P('M4 4l6 6')}{P('M20 20l-6-6')}</>,
  restore:  <>{P('M4 4v5h5')}{P('M4 9a8 8 0 1 1-1 4')}</>,
  check:    <>{P('M5 12.5l4.5 4.5L19 7')}</>,
  bolt:     <>{P('M13 3L5 13h6l-1 8 8-10h-6l1-8z')}</>,
  cpu:      <>{P('M6 6h12v12H6z')}{P('M9 9h6v6H9z')}{P('M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3')}</>,
  coin:     <>{P('M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0')}{P('M12 7v10')}{P('M14.5 9.2c0-1-1.1-1.7-2.5-1.7s-2.5.7-2.5 1.7 1.1 1.5 2.5 1.7 2.5.8 2.5 1.8-1.1 1.8-2.5 1.8-2.5-.8-2.5-1.8')}</>,
  bash:     <>{P('M4 5h16v14H4z')}{P('M7 9l3 3-3 3')}{P('M12.5 15h4')}</>,
  edit:     <>{P('M5 19h14')}{P('M14 5l4 4-9 9H5v-4l9-9z')}</>,
  read:     <>{P('M4 5h16v14H4z')}{P('M8 9h8M8 12h8M8 15h5')}</>,
  write:    <>{P('M12 4v16M4 12h16')}</>,
  agent:    <>{P('M12 8m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0')}{P('M5 20a7 7 0 0 1 14 0')}</>,
  error:    <>{P('M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0')}{P('M12 7v6')}{P('M12 16.5v.01')}</>,
  user:     <>{P('M12 11m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0')}{P('M4 21a8 8 0 0 1 16 0')}</>,
  sparkle:  <>{P('M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z')}</>,
  filter:   <>{P('M4 5h16l-6 8v6l-4-2v-4L4 5z')}</>,
  refresh:  <>{P('M4 4v5h5')}{P('M20 20v-5h-5')}{P('M19 9a8 8 0 0 0-14-1M5 15a8 8 0 0 0 14 1')}</>,
  grid:     <>{P('M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z')}</>,
  list:     <>{P('M8 6h12M8 12h12M8 18h12')}{P('M4 6v.01M4 12v.01M4 18v.01')}</>,
  dot:      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />,
  arrowDown:<>{P('M12 5v14')}{P('M6 13l6 6 6-6')}</>,
  gear:     <>{P('M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0')}{P('M19.4 13a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.2a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 0 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0 .9-1.4V3a2 2 0 0 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.4.9H21a2 2 0 0 1 0 4h-.2a1.6 1.6 0 0 0-1.4.9z')}</>,
  org:      <>{P('M4 21V7l6-3v17')}{P('M10 21V11l8 3v7')}{P('M3 21h18')}{P('M7 8v.01M7 12v.01M14 15v.01M14 18v.01')}</>,
  lock:     <>{P('M6 11h12v9H6z')}{P('M9 11V8a3 3 0 0 1 6 0v3')}{P('M12 15v2')}</>,
};

export function Icon({ name, size = 18, stroke = 1.7, className, style }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

/** Timeline event-type → icon + tone (used by TimelineTab). */
export const EVENT_META: Record<string, { icon: IconName; tone: 'neutral' | 'accent' | 'warn' | 'danger' | 'edit' | 'write' }> = {
  user:      { icon: 'user',     tone: 'neutral' },
  assistant: { icon: 'sparkle',  tone: 'accent' },
  edit:      { icon: 'edit',     tone: 'edit' },
  read:      { icon: 'read',     tone: 'neutral' },
  write:     { icon: 'write',    tone: 'write' },
  bash:      { icon: 'bash',     tone: 'neutral' },
  search:    { icon: 'search',   tone: 'neutral' },
  agent:     { icon: 'agent',    tone: 'accent' },
  image:     { icon: 'image',    tone: 'warn' },
  error:     { icon: 'error',    tone: 'danger' },
};
