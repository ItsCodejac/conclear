import { clsx } from '../lib/format';

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderDiff(text: string): string {
  return text.split('\n').map(l => {
    const cls = l.startsWith('+') ? 'dl-add' : l.startsWith('-') ? 'dl-del' : l.startsWith('@@') ? 'dl-hunk' : '';
    return `<span class="${cls}">${escape(l)}</span>`;
  }).join('\n');
}

export function DiffBlock({ text }: { text: string }) {
  return <pre className={clsx('detail-pre', 'diff')} dangerouslySetInnerHTML={{ __html: renderDiff(text) }} />;
}

export function DetailBlock({ kind, text }: { kind: 'output' | 'diff'; text: string }) {
  if (kind === 'diff') return <DiffBlock text={text} />;
  return <pre className="detail-pre">{text}</pre>;
}
