#!/usr/bin/env node
/**
 * ConClear MCP Server — expose session history to AI agents via Model Context Protocol.
 *
 * Runs over stdio transport (standard for Claude Code MCP servers).
 * Start with: conclear mcp
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { ClaudeAdapter } from './server/adapters/claude/index.js';
import { parseConversation, parseFileHistory, getFileContent } from './server/adapters/claude/parser.js';
import type { Session } from './server/adapters/types.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

const adapter = new ClaudeAdapter();

function formatDate(ts: number | string | undefined): string {
  if (!ts) return '-';
  const d = new Date(typeof ts === 'string' ? ts : ts);
  if (isNaN(d.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function decodeProjectDir(encoded: string): string {
  const parts = encoded.split('-').filter(Boolean);
  return parts[parts.length - 1] || encoded;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + '...';
}

/** Resolve a session by ID, partial ID, name, or partial name — same logic as cli-query.ts */
async function resolveSession(query: string): Promise<Session | null> {
  const sessions = await adapter.listSessions();
  const q = query.toLowerCase();

  // Exact ID
  let match = sessions.find(s => s.id === query);
  if (match) return match;

  // Partial ID prefix
  const idMatches = sessions.filter(s => s.id.toLowerCase().startsWith(q));
  if (idMatches.length === 1) return idMatches[0];

  // Exact name (case-insensitive)
  match = sessions.find(s => s.name?.toLowerCase() === q);
  if (match) return match;

  // Partial name
  const nameMatches = sessions.filter(s => s.name?.toLowerCase().includes(q));
  if (nameMatches.length === 1) return nameMatches[0];

  // Preview fallback
  const previewMatches = sessions.filter(s => s.preview?.toLowerCase().includes(q));
  if (previewMatches.length === 1) return previewMatches[0];

  // Multiple matches — most recent wins
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

// ── MCP Server ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'conclear-mcp-server',
  version: '0.1.0',
});

// ── Tool: conclear_search ───────────────────────────────────────────────────

server.registerTool(
  'conclear_search',
  {
    title: 'Search ConClear Sessions',
    description: `Search messages across all ConClear sessions by text query.

Returns matching messages with session name, timestamp, role, and a snippet of text around the match.

Args:
  - query (string): Text to search for across all session messages
  - project (string, optional): Filter to sessions whose project name contains this string
  - limit (number, optional): Maximum results to return (default 20, max 100)

Returns: JSON array of matches with sessionId, sessionName, project, timestamp, role, text snippet.`,
    inputSchema: {
      query: z.string().min(1).describe('Text to search for across session messages'),
      project: z.string().optional().describe('Filter to sessions whose project name contains this string'),
      limit: z.number().int().min(1).max(100).default(20).describe('Maximum results to return'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ query, project, limit }) => {
    try {
      const { createReadStream } = await import('fs');
      const { createInterface } = await import('readline');

      const sessions = await adapter.listSessions();
      const queryLower = query.toLowerCase();

      interface SearchResult {
        sessionId: string;
        sessionName: string | null;
        project: string;
        timestamp: string | undefined;
        role: string;
        text: string;
      }

      const results: SearchResult[] = [];

      for (const session of sessions) {
        if (project && !session.project.toLowerCase().includes(project.toLowerCase())) continue;
        if (results.length >= limit) break;

        const rl = createInterface({
          input: createReadStream(session.filePath, { encoding: 'utf-8' }),
          crlfDelay: Infinity,
        });

        for await (const line of rl) {
          if (results.length >= limit) { rl.close(); break; }
          if (!line.trim()) continue;
          if (!line.toLowerCase().includes(queryLower)) continue;

          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            const type = parsed.type as string;
            if (type !== 'user' && type !== 'assistant') continue;

            const message = parsed.message as Record<string, unknown> | undefined;
            if (!message) continue;

            const role = (message.role as string) || type;
            const content = message.content;
            let text = '';

            if (typeof content === 'string') {
              text = content;
            } else if (Array.isArray(content)) {
              for (const block of content) {
                if (typeof block === 'object' && block !== null && (block as Record<string, unknown>).type === 'text') {
                  text += (text ? '\n' : '') + ((block as Record<string, unknown>).text as string || '');
                }
              }
            }

            if (!text.toLowerCase().includes(queryLower)) continue;

            const matchIdx = text.toLowerCase().indexOf(queryLower);
            const start = Math.max(0, matchIdx - 80);
            const end = Math.min(text.length, matchIdx + query.length + 80);
            let snippet = text.slice(start, end).replace(/\n/g, ' ').trim();
            if (start > 0) snippet = '...' + snippet;
            if (end < text.length) snippet = snippet + '...';

            results.push({
              sessionId: session.id,
              sessionName: session.name || session.preview,
              project: decodeProjectDir(session.project),
              timestamp: parsed.timestamp as string | undefined,
              role,
              text: snippet,
            });
          } catch {
            // skip unparseable lines
          }
        }
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  },
);

// ── Tool: conclear_sessions ─────────────────────────────────────────────────

server.registerTool(
  'conclear_sessions',
  {
    title: 'List ConClear Sessions',
    description: `List available ConClear sessions, sorted by most recently active.

Args:
  - project (string, optional): Filter to sessions whose project name contains this string
  - limit (number, optional): Maximum sessions to return (default 20, max 100)

Returns: JSON array of sessions with id, name, preview, project, lastActive, messageCount, imageCount, size.`,
    inputSchema: {
      project: z.string().optional().describe('Filter to sessions whose project name contains this string'),
      limit: z.number().int().min(1).max(100).default(20).describe('Maximum sessions to return'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ project, limit }) => {
    try {
      let sessions = await adapter.listSessions();

      if (project) {
        const pLower = project.toLowerCase();
        sessions = sessions.filter(s => s.project.toLowerCase().includes(pLower));
      }

      sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
      sessions = sessions.slice(0, limit);

      const data = sessions.map(s => ({
        id: s.id,
        name: s.name,
        preview: s.preview ? truncate(s.preview, 80) : null,
        project: decodeProjectDir(s.project),
        lastActive: new Date(s.lastActiveAt).toISOString(),
        messageCount: s.messageCount,
        imageCount: s.imageCount,
        size: s.totalSizeBytes,
      }));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  },
);

// ── Tool: conclear_summary ──────────────────────────────────────────────────

server.registerTool(
  'conclear_summary',
  {
    title: 'Get ConClear Session Summary',
    description: `Get a summary of a specific ConClear session including files touched and key user messages.

Resolves the session by exact ID, partial ID prefix, exact name, or partial name match.

Args:
  - session (string): Session name, ID, or partial match

Returns: JSON object with session metadata, files touched, and key user messages.`,
    inputSchema: {
      session: z.string().min(1).describe('Session name, ID, or partial match to identify the session'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ session: sessionQuery }) => {
    try {
      const session = await resolveSession(sessionQuery);
      if (!session) {
        return {
          content: [{ type: 'text' as const, text: `Error: Session not found for query "${sessionQuery}". Use conclear_sessions to list available sessions.` }],
        };
      }

      const conversation = await parseConversation(session.filePath);
      const fileHistories = await parseFileHistory(session.filePath);

      const userMsgs = conversation.messages
        .filter(m => m.role === 'user' && m.text.trim().length > 10)
        .slice(0, 8);

      const filesTouched = fileHistories.map(h => h.filePath);

      const summary = {
        id: session.id,
        name: session.name,
        preview: session.preview,
        project: decodeProjectDir(session.project),
        firstMessage: formatDate(session.createdAt),
        lastMessage: formatDate(session.lastActiveAt),
        messageCount: session.messageCount,
        imageCount: session.imageCount,
        size: session.totalSizeBytes,
        filesTouched: filesTouched.length,
        files: filesTouched.slice(0, 30),
        keyMessages: userMsgs.map(m => ({
          timestamp: formatDate(m.timestamp),
          text: truncate(m.text, 200),
        })),
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  },
);

// ── Tool: conclear_file_content ─────────────────────────────────────────────

server.registerTool(
  'conclear_file_content',
  {
    title: 'Get File Content from ConClear Session',
    description: `Get a specific file version from a ConClear session.

Finds file versions that were read, edited, or written during the session. Returns the content of a specific version (defaults to the latest).

Args:
  - session (string): Session name, ID, or partial match
  - file_path (string): File path to look for (matched case-insensitively, supports partial paths)
  - version (number, optional): Version index (0-based). Defaults to the latest version.

Returns: JSON object with file path, version info, and content. If multiple files match, lists the matches instead.`,
    inputSchema: {
      session: z.string().min(1).describe('Session name, ID, or partial match'),
      file_path: z.string().min(1).describe('File path or partial path to find'),
      version: z.number().int().min(0).optional().describe('Version index (0-based), defaults to latest'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ session: sessionQuery, file_path, version }) => {
    try {
      const session = await resolveSession(sessionQuery);
      if (!session) {
        return {
          content: [{ type: 'text' as const, text: `Error: Session not found for query "${sessionQuery}". Use conclear_sessions to list available sessions.` }],
        };
      }

      const fileHistories = await parseFileHistory(session.filePath);
      const pathLower = file_path.toLowerCase();

      // Find matching file histories
      const matches = fileHistories.filter(h =>
        h.filePath.toLowerCase().includes(pathLower)
      );

      if (matches.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `No files matching "${file_path}" found in this session. ${fileHistories.length} files tracked total.` }],
        };
      }

      if (matches.length > 1) {
        // If exact match exists among the results, use that
        const exact = matches.find(h => h.filePath.toLowerCase() === pathLower || h.filePath.toLowerCase().endsWith('/' + pathLower));
        if (!exact) {
          const listing = matches.slice(0, 20).map(h => ({
            filePath: h.filePath,
            versions: h.versions.length,
          }));
          return {
            content: [{ type: 'text' as const, text: `Multiple files match "${file_path}". Be more specific:\n${JSON.stringify(listing, null, 2)}` }],
          };
        }
        matches.length = 0;
        matches.push(exact);
      }

      const fileHistory = matches[0];
      const versionIdx = version ?? fileHistory.versions.length - 1;

      if (versionIdx >= fileHistory.versions.length) {
        return {
          content: [{ type: 'text' as const, text: `Error: Version ${versionIdx} does not exist. This file has ${fileHistory.versions.length} version(s) (0-${fileHistory.versions.length - 1}).` }],
        };
      }

      const ver = fileHistory.versions[versionIdx];
      const content = await getFileContent(session.filePath, ver.lineNumber);

      const result = {
        filePath: fileHistory.filePath,
        version: versionIdx,
        totalVersions: fileHistory.versions.length,
        operation: ver.operation,
        timestamp: ver.timestamp,
        lineCount: ver.lineCount,
        content: content ? truncate(content, 50000) : null,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  },
);

// ── Tool: conclear_context ──────────────────────────────────────────────────

server.registerTool(
  'conclear_context',
  {
    title: 'Get Conversation Context from ConClear Session',
    description: `Get clean conversation text from a ConClear session (user and assistant messages only, no tool results noise).

Args:
  - session (string): Session name, ID, or partial match
  - limit (number, optional): Return only the last N messages (default: all messages)

Returns: JSON array of messages with role, timestamp, and text.`,
    inputSchema: {
      session: z.string().min(1).describe('Session name, ID, or partial match'),
      limit: z.number().int().min(1).optional().describe('Return only the last N messages'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ session: sessionQuery, limit }) => {
    try {
      const session = await resolveSession(sessionQuery);
      if (!session) {
        return {
          content: [{ type: 'text' as const, text: `Error: Session not found for query "${sessionQuery}". Use conclear_sessions to list available sessions.` }],
        };
      }

      const conversation = await parseConversation(session.filePath);

      // Filter to user/assistant text only, no tool results
      let messages = conversation.messages.filter(m =>
        (m.role === 'user' || m.role === 'assistant') && m.text.trim().length > 0 && !m.toolUse
      );

      if (limit) {
        messages = messages.slice(-limit);
      }

      const data = messages.map(m => ({
        role: m.role,
        timestamp: m.timestamp,
        text: truncate(m.text, 4000),
      }));

      // Truncate total output to avoid overwhelming context
      const output = JSON.stringify(data, null, 2);
      const finalOutput = output.length > 100000
        ? output.slice(0, 100000) + '\n... (truncated, use limit parameter to get fewer messages)'
        : output;

      return {
        content: [{ type: 'text' as const, text: finalOutput }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  },
);

// ── Start server ────────────────────────────────────────────────────────────

export async function startMcpServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so it doesn't interfere with MCP stdio protocol on stdout
  process.stderr.write('ConClear MCP server running via stdio\n');
}

// Allow direct execution
const isDirectRun = process.argv[1]?.endsWith('mcp-server.js') || process.argv[1]?.endsWith('mcp-server.ts');
if (isDirectRun) {
  startMcpServer().catch(err => {
    process.stderr.write(`MCP server error: ${err.message || err}\n`);
    process.exit(1);
  });
}
