/**
 * Highlights all occurrences of `query` within `text` using a <mark> element.
 * Case-insensitive plain-string match (no regex).
 * When query is empty or not found, renders the text unchanged.
 */
import type { ReactNode } from 'react';

export function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;

  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let idx = lower.indexOf(q, cursor);

  while (idx !== -1) {
    if (idx > cursor) parts.push(text.slice(cursor, idx));
    parts.push(
      <mark key={idx} style={{ background: 'transparent', color: '#f59e0b', padding: 0 }}>
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    cursor = idx + q.length;
    idx = lower.indexOf(q, cursor);
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  if (parts.length === 0) return <>{text}</>;

  return <>{parts}</>;
}
