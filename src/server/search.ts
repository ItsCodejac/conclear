/**
 * Shared session search used by the REST, MCP, and CLI surfaces.
 *
 * Two layers:
 *  - `searchSessionFile`: line-oriented search over Anthropic-shaped JSONL/JSON
 *    (Claude, Cline). Used as the fallback for adapters without their own.
 *  - `searchAllAdapters`: iterates adapters, calling `adapter.searchMessages`
 *    where present (e.g. Cursor's SQLite-aware variant) and falling back to
 *    `searchSessionFile` otherwise. Single entry point for callers.
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import type { Session, SearchResult } from './adapters/types.js';
import { ADAPTERS } from './adapters/registry.js';

/** Strip system-level XML tags from text so they don't pollute search results. */
export function stripSystemTags(input: string): string {
  return input
    .replace(/<(?:system-reminder|local-command-caveat|command-name|command-message|command-args|task-notification|user-prompt-submit-hook|antml:[a-z_]+|env|functions|function)[^>]*>[\s\S]*?<\/(?:system-reminder|local-command-caveat|command-name|command-message|command-args|task-notification|user-prompt-submit-hook|antml:[a-z_]+|env|functions|function)>/gi, '')
    .trim();
}

/** Extract plain text from a JSONL message content field. */
export function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return stripSystemTags(content);
  if (!Array.isArray(content)) return '';

  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'object' && block !== null) {
      const b = block as Record<string, unknown>;
      if (b.type === 'text' && typeof b.text === 'string') {
        parts.push(b.text);
      }
    }
  }
  return stripSystemTags(parts.join('\n'));
}

/**
 * Search a single session file for a query string.
 * Returns up to maxPerSession results. Best-effort for non-JSONL files —
 * lines that aren't valid Anthropic-shaped JSON are skipped.
 */
export async function searchSessionFile(
  session: Session,
  queryLower: string,
  maxPerSession: number,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  try {
    const rl = createInterface({
      input: createReadStream(session.filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });

    let lineIdx = 0;
    for await (const line of rl) {
      if (results.length >= maxPerSession) {
        rl.close();
        break;
      }
      if (!line.trim()) { lineIdx++; continue; }

      // Fast pre-checks: skip lines that don't look like user/assistant messages
      if (!line.includes('"user"') && !line.includes('"assistant"')) { lineIdx++; continue; }
      if (!line.toLowerCase().includes(queryLower)) { lineIdx++; continue; }

      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const type = parsed.type as string;
        if (type !== 'user' && type !== 'assistant') { lineIdx++; continue; }

        const message = parsed.message as Record<string, unknown> | undefined;
        if (!message) { lineIdx++; continue; }

        const role = (message.role as string) === 'assistant' ? 'assistant' : 'user';
        const text = extractMessageText(message.content);
        if (!text) { lineIdx++; continue; }

        const textLower = text.toLowerCase();
        const matchIdx = textLower.indexOf(queryLower);
        if (matchIdx === -1) { lineIdx++; continue; }

        const radius = 100;
        const start = Math.max(0, matchIdx - radius);
        const end = Math.min(text.length, matchIdx + queryLower.length + radius);
        let snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
        if (start > 0) snippet = '...' + snippet;
        if (end < text.length) snippet = snippet + '...';

        results.push({
          sessionId: session.id,
          sessionName: session.name,
          project: session.project,
          tool: session.tool,
          timestamp: parsed.timestamp as string | undefined,
          role: role as 'user' | 'assistant',
          text: snippet,
          lineNumber: lineIdx,
        });
      } catch {
        // skip unparseable lines
      }
      lineIdx++;
    }
  } catch {
    // file read error, skip session
  }

  return results;
}

/**
 * Search every detected adapter for messages matching `query`.
 *
 * Adapters that implement `searchMessages` (e.g. Cursor's SQLite-aware
 * variant) get to handle their own search. Adapters without it fall back
 * to `searchSessionFile` over each session, batched in parallel.
 *
 * Results are merged, sorted by timestamp (newest first), and capped at
 * `limit`. An optional `projectFilter` narrows by case-insensitive substring.
 */
export async function searchAllAdapters(
  query: string,
  limit: number,
  projectFilter?: string,
): Promise<SearchResult[]> {
  const queryLower = query.toLowerCase();
  const pLower = projectFilter?.toLowerCase();
  const all: SearchResult[] = [];

  for (const adapter of ADAPTERS) {
    try {
      if (!(await adapter.detect())) continue;
    } catch { continue; }

    if (adapter.searchMessages) {
      try {
        const adapterResults = await adapter.searchMessages(query, limit);
        const filtered = pLower
          ? adapterResults.filter(r => r.project.toLowerCase().includes(pLower))
          : adapterResults;
        all.push(...filtered);
      } catch { /* skip on error */ }
      continue;
    }

    let sessions: Session[];
    try {
      sessions = await adapter.listSessions();
    } catch { continue; }
    if (pLower) sessions = sessions.filter(s => s.project.toLowerCase().includes(pLower));

    const batchSize = 20;
    for (let i = 0; i < sessions.length; i += batchSize) {
      if (all.length >= limit * 2) break;
      const batch = sessions.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(s => searchSessionFile(s, queryLower, 5)),
      );
      all.push(...batchResults.flat());
    }
  }

  all.sort((a, b) => {
    if (!a.timestamp && !b.timestamp) return 0;
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  return all.slice(0, limit);
}
