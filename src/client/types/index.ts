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
  pattern: string;
  context: string;
  lineNumber: number;
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
  text: string;
  lineNumber: number;
}

export type SortField = 'name' | 'project' | 'tool' | 'lastActiveAt' | 'totalSizeBytes' | 'imageCount';
export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}
