#!/usr/bin/env node
/**
 * ConClear MCP Server — expose session history to AI agents via Model Context Protocol.
 *
 * Runs over stdio transport (standard for Claude Code MCP servers).
 * Start with: conclear mcp
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { z } from 'zod';

import { searchConversations } from './server/search.js';
import { contextPage, readMessages } from './server/context.js';
import { getCurrentVersion } from './update-check.js';
import { listAllSessions, findAdapterFor, resolveSession as resolveSessionShared } from './server/adapters/registry.js';
import type { Session } from './server/adapters/types.js';

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

const resolveSession = resolveSessionShared;

// ── MCP Server ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'conclear-mcp-server',
  version: getCurrentVersion(),
});

server.registerTool('conclear_recovery', {
  title: 'Recovery Status and Captured Points',
  description: 'Read independent local recovery health and enrolled projects, or list captured file points for a project id. A running observer does not certify complete capture or working code. Use the ConClear UI or recovery CLI for explicit pinning and restoration.',
  inputSchema: {
    projectId: z.string().regex(/^[a-f0-9]{24}$/).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    offset: z.number().int().min(0).default(0),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ projectId, limit, offset }) => {
  try {
    const { health, snapshots, isDemo } = await import('./recovery/projects.mjs');
    const value = projectId && !isDemo() ? await snapshots(projectId, { limit, offset }) : await health();
    return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
  } catch (error) {
    return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
  }
});

// ── Tool: conclear_search ───────────────────────────────────────────────────

server.registerTool(
  'conclear_search',
  {
    title: 'Search ConClear Sessions',
    description: `Search recorded user/assistant text. Returns compact matches with messageRef, messageIndex, matchOffset, and coverage metadata. Use conclear_context with sessionId as session, tool, and messageRef as around to inspect the original passage. Results are evidence, not verified conclusions. Omitted matches and unreadable sources are explicit.`,
    inputSchema: {
      query: z.string().trim().min(1).max(500).describe('Text to search for across session messages'),
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
      const data = await searchConversations(query, limit, project);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
    } catch (error) {
      return {
        isError: true,
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
      let sessions = await listAllSessions();

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
        tool: s.tool,
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

      const a = await findAdapterFor(session);
      if (!a) {
        return {
          content: [{ type: 'text' as const, text: `Error: No adapter found for session ${session.id}` }],
        };
      }

      // Conversation is implemented by every adapter; file history only by some.
      const conversation = await a.getConversation(session.id);
      let filesTouched: string[] = [];
      if (a.getFileHistory) {
        try {
          const fileHistories = await a.getFileHistory(session.id);
          filesTouched = fileHistories.map(h => h.filePath);
        } catch { /* fall through */ }
      }

      const userMsgs = (conversation?.messages ?? [])
        .filter(m => m.role === 'user' && m.text?.trim().length > 10)
        .slice(0, 8);

      const summary = {
        id: session.id,
        name: session.name,
        preview: session.preview,
        project: decodeProjectDir(session.project),
        tool: session.tool,
        firstMessage: formatDate(session.createdAt),
        lastMessage: formatDate(session.lastActiveAt),
        messageCount: session.messageCount,
        imageCount: session.imageCount,
        size: session.totalSizeBytes,
        filesTouched: filesTouched.length,
        files: filesTouched.slice(0, 30),
        fileHistorySupported: typeof a.getFileHistory === 'function',
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

      const a = await findAdapterFor(session);
      if (!a) {
        return {
          content: [{ type: 'text' as const, text: `Error: No adapter found for session ${session.id}` }],
        };
      }
      if (!a.getFileHistory) {
        return {
          content: [{ type: 'text' as const, text: `File history is not yet supported for ${session.tool} sessions. Supported today: Claude Code, Cline / Roo Code.` }],
        };
      }
      const fileHistories = await a.getFileHistory(session.id);
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
      const content = a.getFileContent ? await a.getFileContent(session.id, ver.lineNumber) : null;

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
    description: `Retrieve bounded original conversation text with stable message references and completeness metadata. Defaults to the last 20 messages and 12,000 text characters. Use around from a search hit for nearby messages (default 3 before, 6 after). Use nextCursor/previousCursor as cursor to continue; long messages resume at the first unread character. Supply tool from the search hit to disambiguate session IDs. Changed conversations invalidate cursors; changed messages invalidate references. Coverage is parsed user/assistant text, not tool results. Do not treat a partial page as the complete history.`,
    inputSchema: {
      session: z.string().min(1).describe('Session name, ID, or partial match'),
      tool: z.enum(['claude', 'gemini', 'cline', 'cursor', 'copilot']).optional().describe('Tool from the search result'),
      around: z.string().max(256).optional().describe('Exact messageRef from search or context'),
      before: z.number().int().min(0).max(20).optional().describe('Messages before around (default 3)'),
      after: z.number().int().min(0).max(20).optional().describe('Messages after around (default 6)'),
      offset: z.number().int().min(0).optional().describe('Start at a character within around; requires before=0. Use matchOffset for a deep search hit.'),
      cursor: z.string().max(2048).optional().describe('Continuation cursor; do not combine with around/before/after'),
      limit: z.number().int().min(1).max(50).optional().describe('Maximum messages per page (default 20)'),
      maxChars: z.number().int().min(256).max(50000).optional().describe('Shared text-character budget, excluding JSON metadata (default 12000)'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ session: sessionQuery, tool, ...options }) => {
    try {
      const session = await resolveSessionShared(sessionQuery, tool);
      if (!session) throw new Error('Session not found. Use conclear_sessions to list available sessions.');
      const adapter = await findAdapterFor(session);
      if (!adapter) throw new Error(`No adapter found for session ${session.id}`);
      const data = contextPage(session, await readMessages(adapter, session), options);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  },
);

// ── Tool: conclear_scan_secrets ─────────────────────────────────────────────

server.registerTool(
  'conclear_scan_secrets',
  {
    title: 'Scan ConClear Session for Leaked Credentials',
    description: `Scan a session file for pasted API keys, tokens, AWS credentials, GitHub PATs, .env dumps, and other secrets.

Returns matches with the credential redacted (first 4 / last 4 chars only) so the agent can describe what leaked without re-exposing it.

Args:
  - session (string): Session name, ID, or partial match

Returns: JSON array of findings with type, severity, redacted pattern, line number, and surrounding context. Empty array if nothing matched.`,
    inputSchema: {
      session: z.string().min(1).describe('Session name, ID, or partial match'),
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
        return { content: [{ type: 'text' as const, text: `Error: Session not found for query "${sessionQuery}".` }] };
      }
      const a = await findAdapterFor(session);
      if (!a?.scanSecrets) {
        return { content: [{ type: 'text' as const, text: `Secret scanning is not yet supported for ${session.tool} sessions. Supported today: Claude Code.` }] };
      }
      const findings = await a.scanSecrets(session.id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(findings, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  },
);

// ── Tool: conclear_files ────────────────────────────────────────────────────

server.registerTool(
  'conclear_files',
  {
    title: 'List Files Touched in a ConClear Session',
    description: `List every file that was read, edited, or written during a session, with version count per file.

Use this before conclear_file_content when you don't know the exact path — lets you pick the file you want by name, then fetch its content.

Args:
  - session (string): Session name, ID, or partial match

Returns: JSON array of files with filePath, operation (latest), versionCount, and timestamps.`,
    inputSchema: {
      session: z.string().min(1).describe('Session name, ID, or partial match'),
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
        return { content: [{ type: 'text' as const, text: `Error: Session not found for query "${sessionQuery}".` }] };
      }
      const a = await findAdapterFor(session);
      if (!a?.getFileHistory) {
        return { content: [{ type: 'text' as const, text: `File history is not yet supported for ${session.tool} sessions. Supported today: Claude Code, Cline / Roo Code.` }] };
      }
      const histories = await a.getFileHistory(session.id);
      const data = histories.map(h => ({
        filePath: h.filePath,
        versionCount: h.versions.length,
        latestOperation: h.versions[h.versions.length - 1]?.operation,
        latestTimestamp: h.versions[h.versions.length - 1]?.timestamp,
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }] };
    }
  },
);

// ── Start server ────────────────────────────────────────────────────────────

export interface McpStartOptions {
  /** Use Streamable HTTP transport instead of stdio. */
  http?: boolean;
  /** Port for HTTP transport. Default 7331. */
  port?: number;
}

export async function startMcpServer(opts: McpStartOptions = {}): Promise<void> {
  if (opts.http) {
    const port = opts.port ?? 7331;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    await server.connect(transport);
    const http = createServer((req, res) => {
      transport.handleRequest(req, res).catch(err => {
        res.statusCode = 500;
        res.end(`MCP transport error: ${err?.message || err}`);
      });
    });
    http.listen(port, () => {
      process.stderr.write(`ConClear MCP server running on http://localhost:${port}/ (Streamable HTTP)\n`);
    });
    return;
  }
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
