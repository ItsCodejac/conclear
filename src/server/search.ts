/**
 * Shared session search helpers used by both the REST routes and the MCP server.
 *
 * Search is line-oriented and assumes the file is Anthropic-shaped JSONL or JSON
 * (Claude, Cline). For other adapters (Copilot single-JSON, Cursor SQLite) the
 * line filter degrades gracefully — it just won't match anything, which is the
 * right behavior here since a structured search would be a per-adapter job.
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import type { Session, SearchResult } from './adapters/types.js';

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
