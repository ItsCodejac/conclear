# Data Formats

## Session

The normalized `Session` type used across all adapters:

```typescript
interface Session {
  id: string;                    // unique session identifier
  name: string | null;           // custom name (e.g., from /resume)
  preview: string | null;        // first user message preview
  project: string;               // project directory identifier
  tool: 'claude' | 'gemini' | 'cursor' | 'cline' | 'copilot';
  createdAt: number;             // timestamp (ms since epoch)
  lastActiveAt: number;          // timestamp (ms since epoch)
  messageCount: number;          // total messages
  imageCount: number;            // embedded images
  totalSizeBytes: number;        // session file size
  imageSizeBytes: number;        // total image data size
  filePath: string;              // path to session file on disk
  hasOversizedImages: boolean;   // any image exceeds 2000px
  maxImageDimension: number;     // largest image dimension
}
```

## SessionDetail

Extended session data including the image inventory:

```typescript
interface SessionDetail extends Session {
  images: SessionImage[];
  toolResultSizeBytes: number;
}
```

## SessionImage

```typescript
interface SessionImage {
  id: string;            // unique image ID within session
  lineNumber: number;    // position in session file
  sizeBytes: number;     // base64 data size
  mediaType: string;     // e.g., "image/png"
  context: string;       // surrounding message context
  timestamp?: string;    // when the image was shared
  preview?: string;      // small thumbnail (loaded on demand)
}
```

## ChatMessage

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  timestamp?: string;
  text: string;
  toolUse?: string;      // tool name if this is a tool use message
  hasImage: boolean;
  imageId?: string;
}
```

## TimelineEvent

```typescript
type TimelineEventType =
  | 'user' | 'assistant' | 'edit' | 'read' | 'write'
  | 'bash' | 'search' | 'agent' | 'image' | 'error';

interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timestamp?: string;
  summary: string;        // one-line description
  detail?: string;        // expandable full content
  filePath?: string;      // for file operations
  exitCode?: number;      // for bash commands
  imageId?: string;       // for image events
  durationMs?: number;    // for timed operations
}
```

## FileVersion

```typescript
interface FileVersion {
  filePath: string;
  timestamp?: string;
  operation: 'read' | 'edit' | 'write';
  contentPreview: string;  // first 200 characters
  lineCount: number;
  sizeBytes: number;
  lineNumber: number;      // position in session file for retrieval
}
```

## FileHistory

```typescript
interface FileHistory {
  filePath: string;
  versions: FileVersion[];
}
```

## SecretFinding

```typescript
interface SecretFinding {
  type: string;          // e.g., "api_key", "bearer_token"
  pattern: string;       // redacted match (first 4 + last 4 chars)
  context: string;       // surrounding text (truncated, redacted)
  lineNumber: number;    // position in session file
  timestamp?: string;
  severity: 'high' | 'medium' | 'low';
}
```

## REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sessions` | List all sessions |
| GET | `/api/sessions/:id` | Get session detail |
| GET | `/api/sessions/:id/conversation` | Get chat messages |
| GET | `/api/sessions/:id/images/:imageId` | Get image binary data |
| GET | `/api/sessions/:id/files` | Get file history |
| GET | `/api/sessions/:id/files/:lineNumber` | Get file content at line |
| GET | `/api/sessions/:id/scan` | Scan for secrets |
| GET | `/api/sessions/:id/export` | Export as markdown |
| POST | `/api/sessions/:id/strip` | Strip images |
| POST | `/api/sessions/:id/resize` | Resize images |
| POST | `/api/sessions/:id/restore` | Restore an image |
| GET | `/api/backups` | List backups |
| DELETE | `/api/backups/:name` | Delete a backup |
| DELETE | `/api/backups` | Delete all backups |
