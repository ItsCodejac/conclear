export interface Session {
  id: string;
  name: string | null;
  preview: string | null;
  project: string;
  tool: 'claude' | 'gemini' | 'cursor' | 'cline' | 'copilot';
  createdAt: number;
  lastActiveAt: number;
  messageCount: number;
  imageCount: number;
  totalSizeBytes: number;
  imageSizeBytes: number;
  filePath: string;
  hasOversizedImages: boolean;
  maxImageDimension: number;
  /** Token / cost analytics, when the adapter can compute them. Currently surfaced by Cline / Roo Code. */
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
  preview?: string; // small base64 thumbnail, loaded on demand
}

export interface ImageData {
  base64: string;
  mediaType: string;
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
  /** Short label like "Read: src/foo.ts" — used when the assistant message wraps a tool invocation. */
  toolUse?: string;
  /** Structured tool call, when the adapter can produce one (currently Cursor). */
  toolCall?: {
    name: string;
    args?: string;
    result?: string;
    status?: string;
  };
  hasImage: boolean;
  imageId?: string;
}

export type TimelineEventType =
  | 'user'      // user message
  | 'assistant' // assistant text response
  | 'edit'      // file edit
  | 'read'      // file read
  | 'write'     // file write
  | 'bash'      // shell command
  | 'search'    // grep/glob
  | 'agent'     // subagent spawn
  | 'image'     // screenshot/image shared
  | 'error';    // failed operation

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timestamp?: string;
  summary: string;       // one-line: file path, command snippet, or first line of text
  detail?: string;       // expandable: full text, command output, diff
  filePath?: string;     // for file operations
  exitCode?: number;     // for bash
  imageId?: string;      // for image events
  durationMs?: number;   // for timed operations
}

export interface FileVersion {
  filePath: string;
  timestamp?: string;
  operation: 'read' | 'edit' | 'write';
  contentPreview: string; // first 200 chars
  lineCount: number;
  sizeBytes: number;
  lineNumber: number; // line in JSONL for retrieval
}

export interface FileHistory {
  filePath: string;
  versions: FileVersion[];
}

export interface SecretFinding {
  type: string;        // e.g. "api_key", "bearer_token", "aws_key", "env_file", "private_key"
  pattern: string;     // what matched (redacted -- show first 4 and last 4 chars only)
  context: string;     // surrounding text (truncated, redacted)
  lineNumber: number;  // JSONL line
  timestamp?: string;
  severity: 'high' | 'medium' | 'low';
}

export interface SearchResult {
  sessionId: string;
  sessionName: string | null;
  project: string;
  tool: string;
  timestamp?: string;
  role: 'user' | 'assistant';
  text: string;        // matched text with context (~200 chars, match highlighted with **bold**)
  lineNumber: number;
}

export interface ParsedConversation {
  messages: ChatMessage[];
  timeline: TimelineEvent[];
}

export interface MutationResult {
  backupPath: string;
  bytesReclaimed: number;
}

export interface Adapter {
  name: string;
  detect(): Promise<boolean>;
  listSessions(): Promise<Session[]>;
  getSessionDetail(sessionId: string): Promise<SessionDetail>;

  // Image lifecycle — every adapter implements these.
  getImageData(sessionId: string, imageId: string): Promise<ImageData>;
  stripImages(sessionId: string, imageIds: string[]): Promise<MutationResult>;
  stripAllImages(sessionId: string): Promise<MutationResult>;
  restoreImage(sessionId: string, imageId: string, base64: string, mediaType: string): Promise<void>;

  // Conversation read — every adapter implements this.
  getConversation(sessionId: string): Promise<ParsedConversation>;

  // Optional capabilities. The presence/absence of each method is the
  // authoritative answer to "can this adapter do X for this session" —
  // see capabilitiesOf() below for a structured snapshot.
  getFileHistory?(sessionId: string): Promise<FileHistory[]>;
  getFileContent?(sessionId: string, lineNumber: number): Promise<string | null>;
  scanSecrets?(sessionId: string): Promise<SecretFinding[]>;
  redactSecrets?(sessionId: string, filter: { lineNumber?: number; type?: string } | null): Promise<MutationResult & { replaced: number }>;
  exportSession?(sessionId: string): Promise<{ markdown: string; name: string | null }>;
  resizeImages?(sessionId: string, imageIds: string[] | null, targetBytes: number): Promise<MutationResult>;
  /** Adapter-specific search — overrides the default line-based search when present. */
  searchMessages?(query: string, limit: number): Promise<SearchResult[]>;
  /** Reset internal session caches so the next listSessions() re-parses everything. */
  clearCache?(): void;
}

export interface AdapterCapabilities {
  fileHistory: boolean;
  fileContent: boolean;
  scanSecrets: boolean;
  redactSecrets: boolean;
  exportSession: boolean;
  resizeImages: boolean;
  searchMessages: boolean;
  clearCache: boolean;
}

export function capabilitiesOf(adapter: Adapter): AdapterCapabilities {
  return {
    fileHistory: typeof adapter.getFileHistory === 'function',
    fileContent: typeof adapter.getFileContent === 'function',
    scanSecrets: typeof adapter.scanSecrets === 'function',
    redactSecrets: typeof adapter.redactSecrets === 'function',
    exportSession: typeof adapter.exportSession === 'function',
    resizeImages: typeof adapter.resizeImages === 'function',
    searchMessages: typeof adapter.searchMessages === 'function',
    clearCache: typeof adapter.clearCache === 'function',
  };
}
