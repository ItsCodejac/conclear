import { useState } from 'react';
import { Icon } from '../../lib/icons';
import { clsx } from '../../lib/format';
import type { Session, ChatMessage } from '../../lib/types';
import { useConversation } from '../../hooks/useSessionDetail';
import { thumbStyle } from '../../extras/Lightbox';
import { EmptyTab } from './EmptyTab';

interface Props { session: Session }

function ToolCall({ call }: { call: NonNullable<ChatMessage['toolCall']> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="toolcall">
      <div className="toolcall-head" onClick={() => setOpen(o => !o)}>
        <Icon name="bolt" size={13} style={{ color: 'var(--accent)' }} />
        <span className="tc-name">{call.name}</span>
        <Icon name="chevron" size={13} className={clsx('tl-chev', open && 'open')} style={{ color: 'var(--muted2)' }} />
        {call.status && <span className={clsx('tc-status', call.status)}>{call.status}</span>}
      </div>
      {open && (
        <div className="tc-body">
          {call.args && <div className="tc-section"><div className="tcl">Arguments</div><pre>{call.args}</pre></div>}
          {call.result && <div className="tc-section"><div className="tcl">Result</div><pre>{call.result}</pre></div>}
        </div>
      )}
    </div>
  );
}

export function ChatTab({ session }: Props) {
  const conv = useConversation(session.id);
  const [filter, setFilter] = useState<'all' | 'user' | 'assistant'>('all');
  const [q, setQ] = useState('');

  if (conv.loading) return <EmptyTab icon="chat" title="Loading conversation…" sub="Parsing the session transcript." />;
  if (!conv.data || conv.data.messages.length === 0) {
    return <EmptyTab icon="chat" title="Conversation replay" sub={`${session.messageCount} messages — could not parse this session into a clean transcript.`} />;
  }

  const shown = conv.data.messages.filter(m =>
    (filter === 'all' || m.role === filter) &&
    (!q || m.text.toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <div>
      <div className="chatfilters">
        <div className="searchbox" style={{ maxWidth: 280 }}>
          <Icon name="search" size={14} />
          <input placeholder="Search messages…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <span style={{ flex: 1 }} />
        {(['all', 'user', 'assistant'] as const).map(f => (
          <span key={f} className={clsx('chip', filter === f && 'on')} onClick={() => setFilter(f)} style={{ textTransform: 'capitalize' }}>{f}</span>
        ))}
      </div>
      {shown.map(m => (
        <div key={m.id} className={clsx('msg', m.role)}>
          <div className="msg-av">
            <Icon name={m.role === 'user' ? 'user' : 'sparkle'} size={15} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="msg-head">
              <span className="msg-role">{m.role}</span>
              {m.timestamp && <span className="msg-time">{m.timestamp}</span>}
            </div>
            {m.toolUse && (
              <div className="msg-tool">
                <Icon name="bolt" size={12} className="mt-ico" /> {m.toolUse}
              </div>
            )}
            {m.text && <div className="msg-text">{m.text}</div>}
            {m.toolCall && <ToolCall call={m.toolCall} />}
            {m.hasImage && (
              <div className="msg-img">
                <div className="mi-thumb" style={thumbStyle((m.id.charCodeAt(1) * 33) % 360)} />
                <span className="mi-meta">
                  <Icon name="image" size={12} style={{ verticalAlign: -2 }} /> screenshot attached
                </span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
