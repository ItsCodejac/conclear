/**
 * Single source of truth for the set of session-reading adapters and helpers
 * for routing operations across them.
 *
 * Used by routes/sessions.ts (REST), mcp-server.ts (MCP), and cli-query.ts
 * (CLI) so all three surfaces see the same set of tools.
 */

import type { Adapter, Session } from './types.js';
import { ClaudeAdapter } from './claude/index.js';
import { GeminiAdapter } from './gemini/index.js';
import { ClineAdapter } from './cline/index.js';
import { CursorAdapter } from './cursor/index.js';
import { CopilotAdapter } from './copilot/index.js';

/** Authoritative list of adapters. Order matters for fallthrough lookups. */
export const ADAPTERS: Adapter[] = [
  new ClaudeAdapter(),
  new GeminiAdapter(),
  new ClineAdapter(),
  new CursorAdapter(),
  new CopilotAdapter(),
];

/** Sessions from every detected adapter, sorted by lastActiveAt desc. */
export async function listAllSessions(): Promise<Session[]> {
  const all: Session[] = [];
  for (const a of ADAPTERS) {
    try {
      if (await a.detect()) all.push(...(await a.listSessions()));
    } catch { /* skip failing adapter */ }
  }
  all.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  return all;
}

/**
 * Find which adapter owns a given session. Tries by Session.tool first
 * (cheap), falls back to detect + getSessionDetail across every adapter.
 */
const TOOL_TO_ADAPTER_NAME: Record<string, string> = {
  claude: 'Claude Code',
  gemini: 'Gemini CLI',
  cline: 'Cline / Roo Code',
  cursor: 'Cursor',
  copilot: 'GitHub Copilot',
};

export async function findAdapterFor(session: Session): Promise<Adapter | null> {
  const wanted = TOOL_TO_ADAPTER_NAME[session.tool];
  if (wanted) {
    const a = ADAPTERS.find(x => x.name === wanted);
    if (a) return a;
  }
  for (const a of ADAPTERS) {
    try {
      if (await a.detect()) {
        try {
          await a.getSessionDetail(session.id);
          return a;
        } catch { /* not this one */ }
      }
    } catch { /* skip */ }
  }
  return null;
}

/**
 * Resolve a session by ID, partial ID, name, partial name, or preview text.
 * When multiple sessions match, the most recently active one wins.
 */
export async function resolveSession(query: string): Promise<Session | null> {
  const sessions = await listAllSessions();
  const q = query.toLowerCase();

  let match = sessions.find(s => s.id === query);
  if (match) return match;

  const idMatches = sessions.filter(s => s.id.toLowerCase().startsWith(q));
  if (idMatches.length === 1) return idMatches[0];

  match = sessions.find(s => s.name?.toLowerCase() === q);
  if (match) return match;

  const nameMatches = sessions.filter(s => s.name?.toLowerCase().includes(q));
  if (nameMatches.length === 1) return nameMatches[0];

  const previewMatches = sessions.filter(s => s.preview?.toLowerCase().includes(q));
  if (previewMatches.length === 1) return previewMatches[0];

  const all = [...idMatches, ...nameMatches, ...previewMatches];
  if (all.length > 0) {
    const seen = new Set<string>();
    const deduped: Session[] = [];
    for (const s of all) {
      if (!seen.has(s.id)) { seen.add(s.id); deduped.push(s); }
    }
    deduped.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    return deduped[0];
  }

  return null;
}

/** Clear every adapter's internal session cache. Used by ?refresh=true. */
export function clearAllCaches(): void {
  for (const a of ADAPTERS) {
    if (a.clearCache) a.clearCache();
  }
}
