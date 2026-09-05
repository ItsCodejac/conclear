import type { Session } from './adapters/types.js';
import { ADAPTERS } from './adapters/registry.js';
import { readMessages } from './context.js';

/** Search the same full-text messages that context references resolve to.
 * All listed sessions are inspected; retain only the newest `limit` matches in memory.
 * Failures are reported by the agent-facing envelope, never called complete.
 */
export async function searchConversations(
  query: string, limit: number, projectFilter?: string,
  adapters = ADAPTERS,
) {
  if (!query.trim() || query.length > 500) throw new Error('query must contain 1–500 characters');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 to 100');
  const queryLower = query.toLowerCase();
  const matches: ConversationMatch[] = [];
  const failures: Array<{ tool: string; sessionId?: string }> = [];
  let matchedMessages = 0;
  let searchedSessions = 0;
  const newest = (a: ConversationMatch, b: ConversationMatch) =>
    (Date.parse(b.timestamp ?? '') || b.lastActiveAt) - (Date.parse(a.timestamp ?? '') || a.lastActiveAt) ||
    a.tool.localeCompare(b.tool) || a.sessionId.localeCompare(b.sessionId) || b.messageIndex - a.messageIndex;
  for (const adapter of adapters) {
    let sessions: Session[];
    try {
      if (!(await adapter.detect())) continue;
      sessions = await adapter.listSessions();
    } catch { failures.push({ tool: adapter.name }); continue; }
    if (projectFilter) sessions = sessions.filter(s => s.project.toLowerCase().includes(projectFilter.toLowerCase()));
    for (const session of sessions) {
      try {
        const messages = await readMessages(adapter, session);
        searchedSessions++;
        messages.forEach((m, messageIndex) => {
          const matchOffset = m.text.toLowerCase().indexOf(queryLower);
          if (matchOffset < 0) return;
          matchedMessages++;
          const start = Math.max(0, matchOffset - 100);
          const end = Math.min(m.text.length, matchOffset + query.length + 100);
          matches.push({
            sessionId: session.id, sessionName: session.name, project: session.project,
            tool: session.tool, timestamp: m.timestamp, role: m.role as 'user' | 'assistant',
            messageRef: m.messageRef, messageIndex, matchOffset, lastActiveAt: session.lastActiveAt,
            text: (start ? '…' : '') + m.text.slice(start, end).replace(/\s+/g, ' ') + (end < m.text.length ? '…' : ''),
          });
          matches.sort(newest);
          if (matches.length > limit) matches.pop();
        });
      } catch { failures.push({ tool: session.tool, sessionId: session.id }); }
    }
  }
  return {
    matches: matches.map(({ lastActiveAt: _lastActiveAt, ...m }) => m),
    coverage: {
      searchedSessions, matchedMessages, returnedMatches: matches.length,
      omittedMatches: matchedMessages - matches.length, failedSources: failures.slice(0, 20),
      failedSourceCount: failures.length, complete: failures.length === 0 && matchedMessages <= limit,
      scope: 'Parsed user/assistant text in detected sessions; excludes tool calls, tool results, system messages, and images.',
      continuation: 'Use messageRef as around in conclear_context. If matches were omitted, narrow query/project or increase limit (max 100).',
    },
  };
}

interface ConversationMatch {
  sessionId: string; sessionName: string | null; project: string; tool: Session['tool'];
  timestamp?: string; role: 'user' | 'assistant'; text: string;
  messageRef: string; messageIndex: number; matchOffset: number; lastActiveAt: number;
}

/** Existing web search keeps its array response. Agents use searchConversations for coverage. */
export async function searchAllAdapters(query: string, limit: number, projectFilter?: string) {
  return (await searchConversations(query, Math.min(limit, 100), projectFilter)).matches;
}
