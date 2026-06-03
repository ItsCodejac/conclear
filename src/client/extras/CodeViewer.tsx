import { Btn } from '../components/Btn';
import { Icon } from '../lib/icons';

function highlight(line: string): string {
  let s = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (/^\s*\/\//.test(line)) return `<span class="tok-com">${s}</span>`;
  s = s.replace(/(&#39;|&quot;|'|")(?:[^'"]*?)\1/g, m => `<span class="tok-str">${m}</span>`);
  s = s.replace(/\b(import|from|export|default|function|const|let|return|interface|type|async|await|if|new)\b/g, '<span class="tok-kw">$1</span>');
  s = s.replace(/\b(React|number|string|boolean)\b/g, '<span class="tok-ty">$1</span>');
  s = s.replace(/\b(\d+(\.\d+)?)\b/g, '<span class="tok-num">$1</span>');
  return s;
}

interface Props {
  code: string;
  path: string;
  onCopy?: () => void;
}

export function CodeViewer({ code, path, onCopy }: Props) {
  const lines = code.split('\n');
  return (
    <div className="codeview">
      <div className="codeview-head">
        <Icon name="file" size={14} style={{ color: 'var(--muted2)' }} />
        <span className="fc-path" style={{ fontSize: 12 }}>{path}</span>
        <span style={{ flex: 1 }} />
        <Btn icon="copy" variant="ghost" size="sm" onClick={() => { void navigator.clipboard.writeText(code); onCopy?.(); }}>Copy</Btn>
      </div>
      <div className="codeview-body">
        <pre>
          {lines.map((ln, i) => (
            <div className="cline" key={i}>
              <span className="cln">{i + 1}</span>
              <span className="ctext" dangerouslySetInnerHTML={{ __html: highlight(ln) }} />
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
