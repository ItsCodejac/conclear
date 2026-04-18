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
  toolUse?: string;
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

export interface Adapter {
  name: string;
  detect(): Promise<boolean>;
  listSessions(): Promise<Session[]>;
  getSessionDetail(sessionId: string): Promise<SessionDetail>;
  getImageData(sessionId: string, imageId: string): Promise<ImageData>;
  stripImages(sessionId: string, imageIds: string[]): Promise<{ backupPath: string; bytesReclaimed: number }>;
  stripAllImages(sessionId: string): Promise<{ backupPath: string; bytesReclaimed: number }>;
  restoreImage(sessionId: string, imageId: string, base64: string, mediaType: string): Promise<void>;
}
