import { useState, useEffect, useRef, useCallback } from 'react';
import type { ChatMessage } from '../../types';
import { formatTime } from '../../utils';
import styles from './styles.module.css';

interface ConversationViewProps {
  sessionId: string;
  onImageClick?: (imageId: string) => void;
}

function timeStr(ts?: string): string {
  if (!ts) return '';
  return formatTime(ts);
}

function MessageBubble({ msg, onImageClick }: { msg: ChatMessage; onImageClick?: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = msg.text.length > 300;

  return (
    <div className={msg.role === 'user' ? styles.userMsg : styles.assistantMsg}>
      <div className={styles.msgHeader}>
        <span className={msg.role === 'user' ? styles.roleUser : styles.roleAssistant}>
          {msg.role}
        </span>
        {msg.timestamp && (
          <span className={styles.timestamp}>{timeStr(msg.timestamp)}</span>
        )}
        {msg.hasImage && (
          <span
            className={styles.imageTag}
            onClick={() => msg.imageId && onImageClick?.(msg.imageId)}
          >
            IMG
          </span>
        )}
      </div>
      {msg.toolUse && (
        <div className={styles.toolUse}>{msg.toolUse}</div>
      )}
      {msg.text && (
        <>
          <div
            className={expanded || !isLong ? styles.msgText : styles.msgTextCollapsed}
            onClick={() => isLong && setExpanded(!expanded)}
          >
            {msg.text}
          </div>
          {isLong && !expanded && (
            <button className={styles.expandBtn} onClick={() => setExpanded(true)}>
              Show more
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function ConversationView({ sessionId, onImageClick }: ConversationViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [showRole, setShowRole] = useState<'all' | 'user' | 'assistant'>('all');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    setFilter('');
    fetch(`/api/sessions/${sessionId}/conversation`)
      .then(r => r.json())
      .then(data => setMessages(data.messages || data))
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [sessionId]);

  const filtered = messages.filter(m => {
    if (showRole !== 'all' && m.role !== showRole) return false;
    if (filter) {
      const q = filter.toLowerCase();
      return m.text.toLowerCase().includes(q) ||
        (m.toolUse && m.toolUse.toLowerCase().includes(q));
    }
    return true;
  });

  if (loading) return <div className={styles.loading}>Loading conversation...</div>;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <input
          className={styles.searchInput}
          placeholder="Search messages..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <div className={styles.roleFilters}>
          <button
            className={showRole === 'all' ? styles.roleFilterActive : styles.roleFilterBtn}
            onClick={() => setShowRole('all')}
          >All</button>
          <button
            className={showRole === 'user' ? styles.roleFilterActive : styles.roleFilterBtn}
            onClick={() => setShowRole('user')}
          >User</button>
          <button
            className={showRole === 'assistant' ? styles.roleFilterActive : styles.roleFilterBtn}
            onClick={() => setShowRole('assistant')}
          >Assistant</button>
        </div>
        <span className={styles.count}>{filtered.length}</span>
      </div>
      <div className={styles.messages} ref={listRef}>
        {filtered.map(msg => (
          <MessageBubble key={msg.id} msg={msg} onImageClick={onImageClick} />
        ))}
        {filtered.length === 0 && (
          <div className={styles.empty}>
            {filter ? 'No matching messages' : 'No messages in this session'}
          </div>
        )}
      </div>
    </div>
  );
}
