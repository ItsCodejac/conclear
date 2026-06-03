/**
 * UI-side mirror of the backend types from src/server/adapters/types.ts.
 *
 * We re-declare instead of importing from server source so the UI bundle has
 * no server transitively. The shapes are kept identical; if you change
 * a backend type, mirror it here.
 */

export type ToolId = 'claude' | 'gemini' | 'cursor' | 'cline' | 'copilot';

export interface Session {
  id: string;
  name: string | null;
  preview: string | null;
  project: string;
  tool: ToolId;
  createdAt: number;
  lastActiveAt: number;
  messageCount: number;
  imageCount: number;
  totalSizeBytes: number;
  imageSizeBytes: number;
  filePath: string;
  hasOversizedImages: boolean;
  maxImageDimension: number;
  usage?: {
    tokensIn?: number;
    tokensOut?: number;
    cacheReads?: number;
    cacheWrites?: number;
    totalCostUsd?: number;
  };
}

export interface SessionImage {
  id: string;
  lineNumber: number;
  sizeBytes: number;
  mediaType: string;
  context: string;
  timestamp?: string;
  preview?: string;
}

export interface SessionDetail extends Session {
  images: SessionImage[];
  toolResultSizeBytes: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  timestamp?: string;
  text: string;
  toolUse?: string;
  toolCall?: { name: string; args?: string; result?: string; status?: string };
  hasImage: boolean;
  imageId?: string;
}

export type TimelineEventType =
  | 'user' | 'assistant' | 'edit' | 'read' | 'write'
  | 'bash' | 'search' | 'agent' | 'image' | 'error';

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timestamp?: string;
  summary: string;
  detail?: string;
  filePath?: string;
  exitCode?: number;
  imageId?: string;
  durationMs?: number;
}

export interface FileVersion {
  filePath: string;
  timestamp?: string;
  operation: 'read' | 'edit' | 'write';
  contentPreview: string;
  lineCount: number;
  sizeBytes: number;
  lineNumber: number;
}

export interface FileHistory {
  filePath: string;
  versions: FileVersion[];
}

export interface SecretFinding {
  type: string;
  label?: string;
  pattern: string;
  context: string;
  lineNumber: number;
  timestamp?: string;
  severity: 'high' | 'medium' | 'low';
}

export interface ParsedConversation {
  messages: ChatMessage[];
  timeline: TimelineEvent[];
}

export interface BackupItem {
  name: string;
  sizeBytes: number;
  createdAt: number;
  path: string;
}

/* ── Per-tool capability matrix (mirrors capabilitiesOf on the server) ── */
export interface ToolCaps {
  resize: boolean;
  scanSecrets: boolean;
  fileHistory: boolean;
  exportSession: boolean;
}

export const TOOLS: Record<ToolId, { id: ToolId; label: string; short: string; caps: ToolCaps }> = {
  claude:  { id: 'claude',  label: 'Claude Code',  short: 'CLAUDE',  caps: { resize: true,  scanSecrets: true,  fileHistory: true,  exportSession: true } },
  cursor:  { id: 'cursor',  label: 'Cursor',       short: 'CURSOR',  caps: { resize: true,  scanSecrets: true,  fileHistory: true,  exportSession: true } },
  gemini:  { id: 'gemini',  label: 'Gemini CLI',   short: 'GEMINI',  caps: { resize: true,  scanSecrets: false, fileHistory: true,  exportSession: true } },
  cline:   { id: 'cline',   label: 'Cline / Roo',  short: 'CLINE',   caps: { resize: false, scanSecrets: true,  fileHistory: true,  exportSession: true } },
  copilot: { id: 'copilot', label: 'Copilot Chat', short: 'COPILOT', caps: { resize: false, scanSecrets: false, fileHistory: false, exportSession: true } },
};
