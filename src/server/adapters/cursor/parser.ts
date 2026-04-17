/**
 * Cursor conversation parser.
 *
 * Cursor stores state in a single SQLite database:
 *   ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb
 *
 * Two tables:
 *   - ItemTable: VS Code state (key TEXT, value BLOB)
 *   - cursorDiskKV: Cursor-specific data (key TEXT, value BLOB)
 *
 * Conversation model:
 *   composerData:<uuid>  -> session metadata + ordered list of bubble headers
 *   bubbleId:<composer>:<bubble> -> individual message with type, text, toolFormerData, images, etc.
 *
 * Bubble types: 1 = user, 2 = assistant
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { Session, SessionDetail, SessionImage, ImageData } from '../types.js';

// ---------------------------------------------------------------------------
// Types for raw Cursor JSON structures
// ---------------------------------------------------------------------------

interface BubbleHeader {
  bubbleId: string;
  type: 1 | 2; // 1 = user, 2 = assistant
  serverBubbleId?: string;
}

interface ComposerData {
  _v: number;
  composerId: string;
  text: string;
  richText: string;
  fullConversationHeadersOnly: BubbleHeader[];
  conversationMap: Record<string, unknown>;
  createdAt?: number;
  unifiedMode?: string | number; // 'chat' | 'agent' | number
  forceMode?: string;
  isAgentic?: boolean;
  modelConfig?: { modelName?: string; maxMode?: boolean };
  context?: {
    selectedImages?: CursorImage[];
    fileSelections?: Array<{ uri?: string }>;
    folderSelections?: Array<{ uri?: string }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface CursorImage {
  base64?: string;
  mediaType?: string;
  url?: string;
  [key: string]: unknown;
}

interface ToolFormerData {
  tool?: number;
  name?: string;
  status?: string;
  rawArgs?: string;
  result?: string;
  params?: string;
  additionalData?: Record<string, unknown>;
  [key: string]: unknown;
}

interface BubbleData {
  _v: number;
  type: 1 | 2;
  bubbleId: string;
  text: string;
  richText?: string;
  images: CursorImage[];
  toolResults: unknown[];
  allThinkingBlocks: unknown[];
  suggestedCodeBlocks: unknown[];
  toolFormerData?: ToolFormerData;
  tokenCount?: { inputTokens?: number; outputTokens?: number };
  isAgentic?: boolean;
  unifiedMode?: number;
  checkpointId?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

function openDb(dbPath: string): DatabaseSync {
  return new DatabaseSync(dbPath, { readOnly: true });
}

function getComposerKeys(db: DatabaseSync): Array<{ key: string; value: string }> {
  const stmt = db.prepare('SELECT key, value FROM cursorDiskKV WHERE key LIKE ?');
  return stmt.all('composerData:%') as Array<{ key: string; value: string }>;
}

function getBubble(db: DatabaseSync, composerId: string, bubbleId: string): BubbleData | null {
  const key = `bubbleId:${composerId}:${bubbleId}`;
  const stmt = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?');
  const row = stmt.get(key) as { value: string } | undefined;
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as BubbleData;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Image detection helpers
// ---------------------------------------------------------------------------

const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const LARGE_BASE64_THRESHOLD = 1024; // bytes — images are typically much larger

function isBase64Image(s: string | undefined): boolean {
  if (!s || s.length < LARGE_BASE64_THRESHOLD) return false;
  // Quick check: starts like typical base64 image data
  return BASE64_RE.test(s.slice(0, 100).replace(/\s/g, ''));
}

function findImagesInBubble(
  bubble: BubbleData,
  composerId: string,
): { images: SessionImage[]; imageSizeBytes: number } {
  const images: SessionImage[] = [];
  let imageSizeBytes = 0;

  // Check bubble.images array
  if (bubble.images && Array.isArray(bubble.images)) {
    for (let i = 0; i < bubble.images.length; i++) {
      const img = bubble.images[i];
      const b64 = img.base64 || '';
      if (!b64 || b64.length < LARGE_BASE64_THRESHOLD) continue;
      const sizeBytes = Math.ceil(b64.length * 0.75); // approximate decoded size
      imageSizeBytes += b64.length; // JSON storage size
      images.push({
        id: `${composerId}:${bubble.bubbleId}:img:${i}`,
        lineNumber: 0, // SQLite, no line numbers
        sizeBytes,
        mediaType: img.mediaType || 'image/png',
        context: bubble.type === 1 ? 'user message image' : 'assistant message image',
      });
    }
  }

  return { images, imageSizeBytes };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse all composer sessions from the Cursor database.
 */
export function parseAllSessions(dbPath: string): Session[] {
  const db = openDb(dbPath);
  const sessions: Session[] = [];

  try {
    const composerRows = getComposerKeys(db);

    for (const row of composerRows) {
      if (!row.value) continue;
      let data: ComposerData;
      try {
        data = JSON.parse(row.value) as ComposerData;
      } catch {
        continue;
      }
      if (!data.composerId) continue;

      const headers = data.fullConversationHeadersOnly || [];
      // Skip empty composers (no messages)
      if (headers.length === 0) continue;

      // Count user vs assistant messages
      const userCount = headers.filter(h => h.type === 1).length;
      const assistantCount = headers.filter(h => h.type === 2).length;
      const messageCount = userCount + assistantCount;

      // Derive session name from first user message
      let name: string | null = null;
      const firstUserHeader = headers.find(h => h.type === 1);
      if (firstUserHeader) {
        const bubble = getBubble(db, data.composerId, firstUserHeader.bubbleId);
        if (bubble?.text) {
          const firstLine = bubble.text.split('\n')[0].trim();
          name = firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
        }
      }

      // Preview: first user message text (truncated)
      let preview: string | null = null;
      if (firstUserHeader) {
        const bubble = getBubble(db, data.composerId, firstUserHeader.bubbleId);
        if (bubble?.text) {
          preview = bubble.text.slice(0, 200).replace(/\n/g, ' ').trim();
        }
      }

      // Determine project from context file selections or workspace
      let project = 'Cursor';
      if (data.context?.fileSelections?.length) {
        const uri = data.context.fileSelections[0].uri || '';
        const match = uri.match(/file:\/\/\/(.*?)\//);
        if (match) {
          const parts = uri.replace('file:///', '').split('/');
          // Use last 2 path segments as project identifier
          project = parts.slice(0, Math.min(parts.length - 1, 3)).join('/');
        }
      }

      // Estimate size from the composer JSON value
      const totalSizeBytes = Buffer.byteLength(row.value, 'utf-8');

      // Scan bubbles for images (sampling for performance on large sessions)
      let imageCount = 0;
      let imageSizeBytes = 0;
      let hasOversizedImages = false;
      let maxImageDimension = 0;

      // Only check a subset of bubbles for the list view to stay fast
      const sampled = headers.length > 20 ? headers.filter((_, i) => i % 5 === 0) : headers;
      for (const h of sampled) {
        const bubble = getBubble(db, data.composerId, h.bubbleId);
        if (!bubble) continue;
        const result = findImagesInBubble(bubble, data.composerId);
        imageCount += result.images.length;
        imageSizeBytes += result.imageSizeBytes;
      }

      const createdAt = data.createdAt || 0;

      // Estimate lastActiveAt: use createdAt as base (we don't have per-bubble timestamps)
      // The DB mtime is a better proxy but we don't have it here
      const lastActiveAt = createdAt;

      const mode = typeof data.unifiedMode === 'string' ? data.unifiedMode :
                   typeof data.forceMode === 'string' ? data.forceMode :
                   data.isAgentic ? 'agent' : 'chat';

      sessions.push({
        id: data.composerId,
        name,
        preview,
        project,
        tool: 'cursor',
        createdAt,
        lastActiveAt,
        messageCount,
        imageCount,
        totalSizeBytes,
        imageSizeBytes,
        filePath: dbPath,
        hasOversizedImages,
        maxImageDimension,
      });
    }
  } finally {
    db.close();
  }

  return sessions;
}

/**
 * Get detailed session info including full image inventory.
 */
export function parseSessionDetail(dbPath: string, composerId: string): SessionDetail | null {
  const db = openDb(dbPath);

  try {
    const row = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?')
      .get(`composerData:${composerId}`) as { value: string } | undefined;
    if (!row?.value) return null;

    let data: ComposerData;
    try {
      data = JSON.parse(row.value) as ComposerData;
    } catch {
      return null;
    }

    const headers = data.fullConversationHeadersOnly || [];

    // Derive name
    let name: string | null = null;
    let preview: string | null = null;
    const firstUserHeader = headers.find(h => h.type === 1);
    if (firstUserHeader) {
      const bubble = getBubble(db, data.composerId, firstUserHeader.bubbleId);
      if (bubble?.text) {
        const firstLine = bubble.text.split('\n')[0].trim();
        name = firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
        preview = bubble.text.slice(0, 200).replace(/\n/g, ' ').trim();
      }
    }

    // Full image scan
    const allImages: SessionImage[] = [];
    let imageSizeBytes = 0;
    let totalSizeBytes = Buffer.byteLength(row.value, 'utf-8');
    let toolResultSizeBytes = 0;

    for (const h of headers) {
      const bubble = getBubble(db, data.composerId, h.bubbleId);
      if (!bubble) continue;

      const result = findImagesInBubble(bubble, data.composerId);
      allImages.push(...result.images);
      imageSizeBytes += result.imageSizeBytes;

      // Measure tool result sizes
      if (bubble.toolFormerData?.result) {
        toolResultSizeBytes += Buffer.byteLength(bubble.toolFormerData.result, 'utf-8');
      }
    }

    let project = 'Cursor';
    if (data.context?.fileSelections?.length) {
      const parts = (data.context.fileSelections[0].uri || '').replace('file:///', '').split('/');
      project = parts.slice(0, Math.min(parts.length - 1, 3)).join('/');
    }

    const userCount = headers.filter(h => h.type === 1).length;
    const assistantCount = headers.filter(h => h.type === 2).length;

    return {
      id: data.composerId,
      name,
      preview,
      project,
      tool: 'cursor',
      createdAt: data.createdAt || 0,
      lastActiveAt: data.createdAt || 0,
      messageCount: userCount + assistantCount,
      imageCount: allImages.length,
      totalSizeBytes,
      imageSizeBytes,
      filePath: dbPath,
      hasOversizedImages: allImages.some(img => img.sizeBytes > 500_000),
      maxImageDimension: 0, // can't determine without decoding
      images: allImages,
      toolResultSizeBytes,
    };
  } finally {
    db.close();
  }
}

/**
 * Extract base64 image data for a specific image.
 * Image IDs follow the format: composerId:bubbleId:img:index
 */
export function getImageData(dbPath: string, imageId: string): ImageData | null {
  const parts = imageId.split(':');
  if (parts.length < 4) return null;

  const composerId = parts[0];
  const bubbleId = parts[1];
  const index = parseInt(parts[3], 10);

  const db = openDb(dbPath);
  try {
    const bubble = getBubble(db, composerId, bubbleId);
    if (!bubble?.images?.[index]) return null;

    const img = bubble.images[index];
    if (!img.base64) return null;

    return {
      base64: img.base64,
      mediaType: img.mediaType || 'image/png',
    };
  } finally {
    db.close();
  }
}

/**
 * Strip image data from specific bubbles in the database.
 * Returns the number of images stripped.
 *
 * IMPORTANT: This modifies the SQLite database. The caller must create a backup first.
 */
export function stripImages(
  dbPath: string,
  composerId: string,
  imageIds: Set<string> | null,
): { stripped: number; bytesReclaimed: number } {
  // Open in read-write mode for stripping
  const db = new DatabaseSync(dbPath);
  let stripped = 0;
  let bytesReclaimed = 0;

  try {
    // Get composer headers to iterate bubbles
    const row = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?')
      .get(`composerData:${composerId}`) as { value: string } | undefined;
    if (!row?.value) return { stripped: 0, bytesReclaimed: 0 };

    const data = JSON.parse(row.value) as ComposerData;
    const headers = data.fullConversationHeadersOnly || [];

    const updateStmt = db.prepare('UPDATE cursorDiskKV SET value = ? WHERE key = ?');

    for (const h of headers) {
      const key = `bubbleId:${composerId}:${h.bubbleId}`;
      const brow = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?').get(key) as { value: string } | undefined;
      if (!brow?.value) continue;

      let bubble: BubbleData;
      try {
        bubble = JSON.parse(brow.value) as BubbleData;
      } catch {
        continue;
      }

      if (!bubble.images?.length) continue;

      let modified = false;
      for (let i = 0; i < bubble.images.length; i++) {
        const imgId = `${composerId}:${h.bubbleId}:img:${i}`;
        if (imageIds !== null && !imageIds.has(imgId)) continue;

        const img = bubble.images[i];
        if (!img.base64 || img.base64.length < LARGE_BASE64_THRESHOLD) continue;

        bytesReclaimed += img.base64.length;
        img.base64 = '';
        stripped++;
        modified = true;
      }

      if (modified) {
        updateStmt.run(JSON.stringify(bubble), key);
      }
    }
  } finally {
    db.close();
  }

  return { stripped, bytesReclaimed };
}

/**
 * Restore image data into a bubble.
 */
export function restoreImage(
  dbPath: string,
  imageId: string,
  base64: string,
  mediaType: string,
): void {
  const parts = imageId.split(':');
  if (parts.length < 4) throw new Error(`Invalid image ID: ${imageId}`);

  const composerId = parts[0];
  const bubbleId = parts[1];
  const index = parseInt(parts[3], 10);

  const db = new DatabaseSync(dbPath);
  try {
    const key = `bubbleId:${composerId}:${bubbleId}`;
    const row = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row?.value) throw new Error(`Bubble not found: ${key}`);

    const bubble = JSON.parse(row.value) as BubbleData;
    if (!bubble.images?.[index]) throw new Error(`Image index ${index} not found in bubble`);

    bubble.images[index].base64 = base64;
    bubble.images[index].mediaType = mediaType;

    db.prepare('UPDATE cursorDiskKV SET value = ? WHERE key = ?').run(JSON.stringify(bubble), key);
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Conversation parsing (for conversation view)
// ---------------------------------------------------------------------------

export interface CursorMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCall?: {
    name: string;
    args: string;
    result?: string;
    status?: string;
  };
  hasImage: boolean;
  imageId?: string;
}

export interface CursorParsedConversation {
  messages: CursorMessage[];
  timeline: Array<{
    id: string;
    type: string;
    summary: string;
    detail?: string;
  }>;
}

export function parseConversation(dbPath: string, composerId: string): CursorParsedConversation {
  const db = openDb(dbPath);
  const messages: CursorMessage[] = [];
  const timeline: CursorParsedConversation['timeline'] = [];

  try {
    const row = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?')
      .get(`composerData:${composerId}`) as { value: string } | undefined;
    if (!row?.value) return { messages, timeline };

    const data = JSON.parse(row.value) as ComposerData;
    const headers = data.fullConversationHeadersOnly || [];

    for (const h of headers) {
      const bubble = getBubble(db, data.composerId, h.bubbleId);
      if (!bubble) continue;

      const role: 'user' | 'assistant' = bubble.type === 1 ? 'user' : 'assistant';
      const hasImage = (bubble.images?.length || 0) > 0 &&
                       bubble.images.some(img => img.base64 && img.base64.length > LARGE_BASE64_THRESHOLD);

      // Handle tool calls (toolFormerData bubbles are assistant type-2 bubbles with no text)
      if (bubble.toolFormerData?.name) {
        const tfd = bubble.toolFormerData;
        const toolName = tfd.name!;
        messages.push({
          id: bubble.bubbleId,
          role: 'assistant',
          text: bubble.text || '',
          toolCall: {
            name: toolName,
            args: tfd.rawArgs || '',
            result: tfd.result ? (tfd.result.length > 2000 ? tfd.result.slice(0, 2000) + '...' : tfd.result) : undefined,
            status: tfd.status || (tfd.additionalData?.status as string) || undefined,
          },
          hasImage,
        });

        // Add to timeline
        timeline.push({
          id: bubble.bubbleId,
          type: mapToolToTimelineType(toolName),
          summary: `${toolName}: ${summarizeToolArgs(tfd.rawArgs || '')}`,
          detail: tfd.result?.slice(0, 500),
        });
      } else if (bubble.text) {
        messages.push({
          id: bubble.bubbleId,
          role,
          text: bubble.text,
          hasImage,
          imageId: hasImage ? `${data.composerId}:${bubble.bubbleId}:img:0` : undefined,
        });

        timeline.push({
          id: bubble.bubbleId,
          type: role,
          summary: bubble.text.split('\n')[0].slice(0, 120),
        });
      }
    }
  } finally {
    db.close();
  }

  return { messages, timeline };
}

function mapToolToTimelineType(toolName: string): string {
  const map: Record<string, string> = {
    run_terminal_cmd: 'bash',
    edit_file: 'edit',
    read_file: 'read',
    write_new_file: 'write',
    codebase_search: 'search',
    grep_search: 'search',
    file_search: 'search',
    list_dir: 'read',
    delete_file: 'edit',
  };
  return map[toolName] || 'assistant';
}

function summarizeToolArgs(rawArgs: string): string {
  try {
    const args = JSON.parse(rawArgs);
    if (args.command) return args.command.slice(0, 100);
    if (args.target_file) return args.target_file;
    if (args.path) return args.path;
    if (args.query) return args.query.slice(0, 80);
    return rawArgs.slice(0, 80);
  } catch {
    return rawArgs.slice(0, 80);
  }
}
