import { Session, SessionDetail, SessionImage, ImageData, ChatMessage, TimelineEvent, TimelineEventType, FileHistory, FileVersion, SecretFinding } from '../types.js';
import { readFile, stat } from 'fs/promises';
import sharp from 'sharp';
import { scanText, redactText, sortFindings, type RedactFilter } from '../secrets.js';

/**
 * Cline / Roo Code session format:
 *
 * Each task lives in a directory: tasks/<task-id>/
 *   - api_conversation_history.json — Array of Anthropic API messages
 *   - ui_messages.json — UI display messages (not used for image ops)
 *   - task_metadata.json — { task: string, tokensIn, tokensOut, ... }
 *
 * api_conversation_history.json is an array of:
 *   { role: 'user'|'assistant', content: ContentBlock[] }
 *
 * ContentBlock is one of:
 *   { type: 'text', text: string }
 *   { type: 'image', source: { type: 'base64', media_type: string, data: string } }
 *   { type: 'tool_use', id: string, name: string, input: object }
 *   { type: 'tool_result', tool_use_id: string, content: string|ContentBlock[] }
 */

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

interface TaskMetadata {
  task?: string;
  tokensIn?: number;
  tokensOut?: number;
  cacheWrites?: number;
  cacheReads?: number;
  totalCost?: number;
}

interface ApiMessage {
  role: 'user' | 'assistant';
  content: ContentBlock[] | string;
}

interface ContentBlock {
  type: string;
  text?: string;
  source?: {
    type: string;
    media_type?: string;
    data?: string;
  };
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
}

interface Base64Blob {
  /** Index path into the message array for identification */
  path: string;
  size: number;
  mediaType: string;
  headerData?: string;
}

function findBase64Blobs(obj: unknown, path: string, results: Base64Blob[], collectHeaders = false): void {
  if (obj === null || obj === undefined) return;

  if (typeof obj === 'object' && !Array.isArray(obj)) {
    const record = obj as Record<string, unknown>;

    // Pattern: image block with source.data
    if (record.type === 'image' && typeof record.source === 'object' && record.source !== null) {
      const source = record.source as Record<string, unknown>;
      if (source.type === 'base64' && typeof source.data === 'string' && (source.data as string).length > 200) {
        const blob: Base64Blob = {
          path: `${path}.source.data`,
          size: Math.ceil((source.data as string).length * 0.75),
          mediaType: (source.media_type as string) || 'image/png',
        };
        if (collectHeaders) blob.headerData = (source.data as string).slice(0, 1000);
        results.push(blob);
        return;
      }
    }

    for (const [key, value] of Object.entries(record)) {
      findBase64Blobs(value, `${path}.${key}`, results, collectHeaders);
    }
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      findBase64Blobs(obj[i], `${path}[${i}]`, results, collectHeaders);
    }
  }
}

/** Read image dimensions from a base64 header snippet without decoding the full image. */
async function getImageDimensionsFromHeader(headerData: string): Promise<{ width: number; height: number } | null> {
  try {
    const buf = Buffer.from(headerData, 'base64');

    // PNG: width at bytes 16-19, height at bytes 20-23 (big-endian uint32)
    if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      if (width > 0 && width < 100000 && height > 0 && height < 100000) {
        return { width, height };
      }
    }

    const meta = await sharp(buf).metadata();
    if (meta.width && meta.height) {
      return { width: meta.width, height: meta.height };
    }
  } catch {
    // header too small or not a valid image
  }
  return null;
}

/**
 * Parse a task directory into a Session summary.
 */
export async function parseTaskSession(
  taskDir: string,
  taskId: string,
  sourceLabel: string,
): Promise<Session | null> {
  try {
    const apiPath = `${taskDir}/api_conversation_history.json`;
    const metaPath = `${taskDir}/task_metadata.json`;

    const apiStats = await stat(apiPath);

    // Load metadata for name
    let taskName: string | null = null;
    let usage: Session['usage'] | undefined;
    try {
      const metaRaw = await readFile(metaPath, 'utf-8');
      const meta: TaskMetadata = JSON.parse(metaRaw);
      if (meta.task) {
        taskName = meta.task.length > 80 ? meta.task.slice(0, 77) + '...' : meta.task;
      }
      if (meta.tokensIn != null || meta.tokensOut != null || meta.totalCost != null) {
        usage = {
          tokensIn: meta.tokensIn,
          tokensOut: meta.tokensOut,
          cacheReads: meta.cacheReads,
          cacheWrites: meta.cacheWrites,
          totalCostUsd: meta.totalCost,
        };
      }
    } catch {
      // no metadata file
    }

    // Parse api_conversation_history.json
    const apiRaw = await readFile(apiPath, 'utf-8');
    const messages: ApiMessage[] = JSON.parse(apiRaw);

    if (!Array.isArray(messages) || messages.length === 0) return null;

    let messageCount = 0;
    let imageCount = 0;
    let imageSizeBytes = 0;
    let firstUserText: string | null = null;
    const imageHeaders: string[] = [];

    for (const msg of messages) {
      messageCount++;

      const content = msg.content;
      if (typeof content === 'string') {
        if (!firstUserText && msg.role === 'user' && content.trim().length > 0) {
          const t = content.trim();
          firstUserText = t.length > 60 ? t.slice(0, 57) + '...' : t;
        }
        continue;
      }

      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          if (!firstUserText && msg.role === 'user' && block.text.trim().length > 0) {
            const t = block.text.trim();
            firstUserText = t.length > 60 ? t.slice(0, 57) + '...' : t;
          }
        }
      }

      // Scan for images
      const blobs: Base64Blob[] = [];
      findBase64Blobs(msg, '', blobs, true);
      imageCount += blobs.length;
      imageSizeBytes += blobs.reduce((sum, b) => sum + b.size, 0);
      for (const b of blobs) {
        if (b.headerData) imageHeaders.push(b.headerData);
      }
    }

    const preview = firstUserText || taskName;

    // Check image dimensions
    let maxImageDimension = 0;
    if (imageCount >= 2 && imageHeaders.length > 0) {
      const dimResults = await Promise.all(
        imageHeaders.map(h => getImageDimensionsFromHeader(h))
      );
      for (const dims of dimResults) {
        if (dims) {
          maxImageDimension = Math.max(maxImageDimension, dims.width, dims.height);
        }
      }
    }
    const hasOversizedImages = imageCount >= 2 && maxImageDimension > 2000;

    return {
      id: taskId,
      name: taskName,
      preview,
      project: sourceLabel,
      tool: 'cline',
      createdAt: apiStats.birthtimeMs,
      lastActiveAt: apiStats.mtimeMs,
      messageCount,
      imageCount,
      totalSizeBytes: apiStats.size,
      imageSizeBytes,
      filePath: apiPath,
      hasOversizedImages,
      maxImageDimension,
      usage,
    };
  } catch {
    return null;
  }
}

/**
 * Parse a task directory into a SessionDetail with full image list.
 */
export async function parseTaskDetail(
  taskDir: string,
  taskId: string,
  sourceLabel: string,
): Promise<SessionDetail | null> {
  try {
    const apiPath = `${taskDir}/api_conversation_history.json`;
    const metaPath = `${taskDir}/task_metadata.json`;

    const apiStats = await stat(apiPath);

    let taskName: string | null = null;
    let usage: Session['usage'] | undefined;
    try {
      const metaRaw = await readFile(metaPath, 'utf-8');
      const meta: TaskMetadata = JSON.parse(metaRaw);
      if (meta.task) {
        taskName = meta.task.length > 80 ? meta.task.slice(0, 77) + '...' : meta.task;
      }
      if (meta.tokensIn != null || meta.tokensOut != null || meta.totalCost != null) {
        usage = {
          tokensIn: meta.tokensIn,
          tokensOut: meta.tokensOut,
          cacheReads: meta.cacheReads,
          cacheWrites: meta.cacheWrites,
          totalCostUsd: meta.totalCost,
        };
      }
    } catch {
      // no metadata
    }

    const apiRaw = await readFile(apiPath, 'utf-8');
    const messages: ApiMessage[] = JSON.parse(apiRaw);
    if (!Array.isArray(messages)) return null;

    let messageCount = 0;
    let firstUserText: string | null = null;
    const images: SessionImage[] = [];
    const imageHeaders: string[] = [];
    let toolResultSizeBytes = 0;
    let lastUserText = '';

    for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
      const msg = messages[msgIdx];
      messageCount++;

      const content = msg.content;

      // Extract text for preview / context
      if (typeof content === 'string') {
        if (msg.role === 'user' && content.trim().length > 0) {
          lastUserText = content.trim();
          if (!firstUserText) {
            firstUserText = lastUserText.length > 60 ? lastUserText.slice(0, 57) + '...' : lastUserText;
          }
        }
        continue;
      }

      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          if (msg.role === 'user' && block.text.trim().length > 0) {
            lastUserText = block.text.trim();
            if (!firstUserText) {
              firstUserText = lastUserText.length > 60 ? lastUserText.slice(0, 57) + '...' : lastUserText;
            }
          }
        }

        // Estimate tool result sizes
        if (block.type === 'tool_result') {
          const trStr = JSON.stringify(block);
          toolResultSizeBytes += Buffer.byteLength(trStr, 'utf-8');
        }
      }

      // Find images in this message
      const blobs: Base64Blob[] = [];
      findBase64Blobs(msg, '', blobs, true);

      for (const blob of blobs) {
        if (blob.headerData) imageHeaders.push(blob.headerData);

        const nearbyText = lastUserText.length > 50 ? lastUserText.slice(0, 47) + '...' : lastUserText;
        const context = nearbyText || `Image in message ${msgIdx + 1}`;

        images.push({
          id: `${msgIdx}-${blob.path}`,
          lineNumber: msgIdx, // message index, used for retrieval
          sizeBytes: blob.size,
          mediaType: blob.mediaType,
          context,
        });
      }
    }

    const imageSizeBytes = images.reduce((sum, img) => sum + img.sizeBytes, 0);
    const preview = firstUserText || taskName;

    // Check image dimensions
    let maxImageDimension = 0;
    if (images.length >= 2 && imageHeaders.length > 0) {
      const dimResults = await Promise.all(
        imageHeaders.map(h => getImageDimensionsFromHeader(h))
      );
      for (const dims of dimResults) {
        if (dims) {
          maxImageDimension = Math.max(maxImageDimension, dims.width, dims.height);
        }
      }
    }
    const hasOversizedImages = images.length >= 2 && maxImageDimension > 2000;

    return {
      id: taskId,
      name: taskName,
      preview,
      project: sourceLabel,
      tool: 'cline',
      createdAt: apiStats.birthtimeMs,
      lastActiveAt: apiStats.mtimeMs,
      messageCount,
      imageCount: images.length,
      totalSizeBytes: apiStats.size,
      imageSizeBytes,
      filePath: apiPath,
      hasOversizedImages,
      maxImageDimension,
      usage,
      images,
      toolResultSizeBytes,
    };
  } catch {
    return null;
  }
}

/**
 * Get raw base64 image data for a specific image in a Cline session.
 * imageId format: "{msgIndex}-{path}" e.g. "5-.content[0].source.data"
 */
export async function getImageData(apiPath: string, imageId: string): Promise<ImageData | null> {
  const dashIdx = imageId.indexOf('-');
  if (dashIdx === -1) return null;

  const msgIdx = parseInt(imageId.substring(0, dashIdx), 10);
  const blobPath = imageId.substring(dashIdx + 1);

  try {
    const raw = await readFile(apiPath, 'utf-8');
    const messages: ApiMessage[] = JSON.parse(raw);

    if (msgIdx < 0 || msgIdx >= messages.length) return null;

    const base64 = extractBase64AtPath(messages[msgIdx], blobPath, '');
    if (base64 && base64.length > 200) {
      let mediaType = 'image/png';
      if (base64.startsWith('/9j/')) mediaType = 'image/jpeg';
      else if (base64.startsWith('UklGR')) mediaType = 'image/webp';
      return { base64, mediaType };
    }
  } catch {
    // parse error
  }
  return null;
}

function extractBase64AtPath(obj: unknown, targetPath: string, currentPath: string): string | null {
  if (obj === null || obj === undefined) return null;

  if (typeof obj === 'object' && !Array.isArray(obj)) {
    const record = obj as Record<string, unknown>;

    if (record.type === 'image' && typeof record.source === 'object' && record.source !== null) {
      const source = record.source as Record<string, unknown>;
      if (`${currentPath}.source.data` === targetPath && typeof source.data === 'string') {
        return source.data;
      }
    }

    for (const [key, value] of Object.entries(record)) {
      const result = extractBase64AtPath(value, targetPath, `${currentPath}.${key}`);
      if (result) return result;
    }
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const result = extractBase64AtPath(obj[i], targetPath, `${currentPath}[${i}]`);
      if (result) return result;
    }
  }

  return null;
}

function setBase64AtPath(obj: unknown, targetPath: string, currentPath: string, value: string, mediaType: string): boolean {
  if (obj === null || obj === undefined) return false;

  if (typeof obj === 'object' && !Array.isArray(obj)) {
    const record = obj as Record<string, unknown>;

    if (record.type === 'image' && typeof record.source === 'object' && record.source !== null) {
      const source = record.source as Record<string, unknown>;
      if (`${currentPath}.source.data` === targetPath) {
        source.data = value;
        source.media_type = mediaType;
        return true;
      }
    }

    for (const [key, val] of Object.entries(record)) {
      if (setBase64AtPath(val, targetPath, `${currentPath}.${key}`, value, mediaType)) return true;
    }
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (setBase64AtPath(obj[i], targetPath, `${currentPath}[${i}]`, value, mediaType)) return true;
    }
  }

  return false;
}

function replaceBase64Blobs(obj: unknown): number {
  if (obj === null || obj === undefined) return 0;
  let replaced = 0;

  if (typeof obj === 'object' && !Array.isArray(obj)) {
    const record = obj as Record<string, unknown>;

    if (record.type === 'image' && typeof record.source === 'object' && record.source !== null) {
      const source = record.source as Record<string, unknown>;
      if (source.type === 'base64' && typeof source.data === 'string' && (source.data as string).length > 200) {
        source.data = TINY_PNG;
        source.media_type = 'image/png';
        replaced++;
        return replaced;
      }
    }

    for (const [, value] of Object.entries(record)) {
      replaced += replaceBase64Blobs(value);
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      replaced += replaceBase64Blobs(item);
    }
  }

  return replaced;
}

/**
 * Strip images from the api_conversation_history.json content.
 * If imageIds is null, strips all images. Otherwise strips only matching IDs.
 */
export function stripImagesFromContent(
  content: string,
  imageIds: Set<string> | null,
): { result: string; stripped: number } {
  const messages: ApiMessage[] = JSON.parse(content);
  let stripped = 0;

  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    const msg = messages[msgIdx];
    const blobs: Base64Blob[] = [];
    findBase64Blobs(msg, '', blobs);

    if (blobs.length > 0) {
      const shouldStrip = imageIds === null || blobs.some(b => imageIds.has(`${msgIdx}-${b.path}`));
      if (shouldStrip) {
        stripped += replaceBase64Blobs(msg);
      }
    }
  }

  return { result: JSON.stringify(messages, null, 2), stripped };
}

async function resizeToTargetSize(data: string, mediaType: string, targetBytes: number): Promise<{ data: string; mediaType: string }> {
  const buffer = Buffer.from(data, 'base64');
  const currentSize = buffer.length;

  if (currentSize <= targetBytes) {
    return { data, mediaType };
  }

  const meta = await sharp(buffer).metadata();
  if (!meta.width || !meta.height) return { data, mediaType };

  let scale = Math.sqrt(targetBytes / currentSize) * 0.9;
  let bestBuffer: Buffer = buffer;
  let attempts = 0;

  while (attempts < 5) {
    const newWidth = Math.max(64, Math.round(meta.width * scale));
    const newHeight = Math.max(64, Math.round(meta.height * scale));

    const resized = await sharp(buffer)
      .resize(newWidth, newHeight, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();

    bestBuffer = resized;
    if (resized.length <= targetBytes) break;

    scale *= Math.sqrt(targetBytes / resized.length) * 0.95;
    attempts++;
  }

  return { data: bestBuffer.toString('base64'), mediaType: 'image/png' };
}

async function resizeBase64Blobs(obj: unknown, targetBytes: number): Promise<number> {
  if (obj === null || obj === undefined) return 0;
  let resized = 0;

  if (typeof obj === 'object' && !Array.isArray(obj)) {
    const record = obj as Record<string, unknown>;

    if (record.type === 'image' && typeof record.source === 'object' && record.source !== null) {
      const source = record.source as Record<string, unknown>;
      if (source.type === 'base64' && typeof source.data === 'string' && (source.data as string).length > 200) {
        const result = await resizeToTargetSize(source.data as string, (source.media_type as string) || 'image/png', targetBytes);
        if (result.data !== source.data) {
          source.data = result.data;
          source.media_type = result.mediaType;
          resized++;
        }
        return resized;
      }
    }

    for (const [, value] of Object.entries(record)) {
      resized += await resizeBase64Blobs(value, targetBytes);
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      resized += await resizeBase64Blobs(item, targetBytes);
    }
  }

  return resized;
}

/**
 * Resize images in api_conversation_history.json content.
 */
export async function resizeImagesInContent(
  content: string,
  imageIds: Set<string> | null,
  targetBytes: number,
): Promise<{ result: string; resized: number }> {
  const messages: ApiMessage[] = JSON.parse(content);
  let resized = 0;

  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    const msg = messages[msgIdx];
    const blobs: Base64Blob[] = [];
    findBase64Blobs(msg, '', blobs);

    if (blobs.length > 0) {
      const shouldResize = imageIds === null || blobs.some(b => imageIds.has(`${msgIdx}-${b.path}`));
      if (shouldResize) {
        resized += await resizeBase64Blobs(msg, targetBytes);
      }
    }
  }

  return { result: JSON.stringify(messages, null, 2), resized };
}

/**
 * Restore a single image in api_conversation_history.json.
 */
export async function restoreImageInContent(
  content: string,
  imageId: string,
  base64: string,
  mediaType: string,
): Promise<string> {
  const dashIdx = imageId.indexOf('-');
  if (dashIdx === -1) throw new Error('Invalid image ID');

  const msgIdx = parseInt(imageId.substring(0, dashIdx), 10);
  const blobPath = imageId.substring(dashIdx + 1);

  const messages: ApiMessage[] = JSON.parse(content);
  if (msgIdx < 0 || msgIdx >= messages.length) throw new Error('Message index out of range');

  const success = setBase64AtPath(messages[msgIdx], blobPath, '', base64, mediaType);
  if (!success) throw new Error('Could not find image path in message');

  return JSON.stringify(messages, null, 2);
}

/**
 * Parse conversation for the chat/timeline view.
 */
export interface ClineParsedConversation {
  messages: ChatMessage[];
  timeline: TimelineEvent[];
}

function toolNameToEventType(toolName: string): TimelineEventType {
  const name = toolName.toLowerCase();
  if (name.includes('edit') || name.includes('replace')) return 'edit';
  if (name.includes('read') || name.includes('list_files') || name.includes('read_file')) return 'read';
  if (name.includes('write') || name.includes('write_to_file')) return 'write';
  if (name.includes('execute') || name.includes('run') || name.includes('bash')) return 'bash';
  if (name.includes('search') || name.includes('grep') || name.includes('glob')) return 'search';
  return 'assistant';
}

/**
 * Classify a Cline tool name into a file operation (read / edit / write) or null.
 */
function fileOpForTool(toolName: string): 'read' | 'edit' | 'write' | null {
  const n = toolName.toLowerCase();
  if (n === 'read_file' || n === 'list_files' || n === 'list_code_definition_names') return 'read';
  if (n === 'write_to_file' || n === 'new_file') return 'write';
  if (n === 'replace_in_file' || n.includes('edit') || n.includes('replace')) return 'edit';
  return null;
}

/**
 * Best-effort: pull a file path out of a tool's input. Cline uses `path`;
 * a few variants (Claude-shaped tools running through Cline) use `file_path`.
 */
function filePathOfInput(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  if (typeof input.path === 'string') return input.path;
  if (typeof input.file_path === 'string') return input.file_path;
  return null;
}

/**
 * Best-effort: pull file content out of a tool input (for write-class ops).
 * Cline write_to_file: input.content. Edit (replace_in_file): input.diff.
 */
function contentOfInput(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  if (typeof input.content === 'string') return input.content;
  if (typeof input.diff === 'string') return input.diff;
  if (typeof input.new_string === 'string') {
    return `--- old ---\n${input.old_string || ''}\n--- new ---\n${input.new_string}`;
  }
  return null;
}

/**
 * Parse file history from a Cline / Roo Code task. Storage is a single JSON
 * array of Anthropic-shaped messages; we use the message index as the version
 * "lineNumber" since the on-disk JSON has no real line numbers.
 */
export async function parseFileHistory(apiPath: string): Promise<FileHistory[]> {
  const fileVersions = new Map<string, FileVersion[]>();
  const pendingTools = new Map<string, { operation: 'read' | 'edit' | 'write'; filePath: string }>();

  try {
    const raw = await readFile(apiPath, 'utf-8');
    const messages: ApiMessage[] = JSON.parse(raw);
    if (!Array.isArray(messages)) return [];

    for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
      const msg = messages[msgIdx];
      const content = msg.content;
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        // Assistant tool_use blocks: discover operation + file path, and capture
        // write/edit content directly from input.
        if (block.type === 'tool_use') {
          const toolName = block.name || '';
          const op = fileOpForTool(toolName);
          if (!op) continue;

          const input = block.input || {};
          const fp = filePathOfInput(input);
          if (!fp) continue;

          const toolUseId = block.id;
          if (toolUseId) pendingTools.set(toolUseId, { operation: op, filePath: fp });

          if (op !== 'read') {
            const c = contentOfInput(input);
            if (c) {
              const version: FileVersion = {
                filePath: fp,
                operation: op,
                contentPreview: c.slice(0, 200),
                lineCount: c.split('\n').length,
                sizeBytes: Buffer.byteLength(c, 'utf-8'),
                lineNumber: msgIdx,
              };
              if (!fileVersions.has(fp)) fileVersions.set(fp, []);
              fileVersions.get(fp)!.push(version);
            }
          }
        }

        // User tool_result blocks: pair with pending read to capture file content.
        if (block.type === 'tool_result') {
          const toolUseId = block.tool_use_id;
          const pending = toolUseId ? pendingTools.get(toolUseId) : undefined;

          let resultText = '';
          if (typeof block.content === 'string') {
            resultText = block.content;
          } else if (Array.isArray(block.content)) {
            for (const c of block.content) {
              if (typeof c === 'object' && c !== null && (c as unknown as Record<string, unknown>).type === 'text') {
                resultText += (resultText ? '\n' : '') + ((c as unknown as Record<string, unknown>).text as string || '');
              }
            }
          }

          if (pending && pending.operation === 'read' && resultText.length > 0) {
            const version: FileVersion = {
              filePath: pending.filePath,
              operation: 'read',
              contentPreview: resultText.slice(0, 200),
              lineCount: resultText.split('\n').length,
              sizeBytes: Buffer.byteLength(resultText, 'utf-8'),
              lineNumber: msgIdx,
            };
            if (!fileVersions.has(pending.filePath)) fileVersions.set(pending.filePath, []);
            fileVersions.get(pending.filePath)!.push(version);
          }

          if (toolUseId) pendingTools.delete(toolUseId);
        }
      }
    }
  } catch {
    return [];
  }

  const histories: FileHistory[] = [];
  for (const [fp, versions] of fileVersions) {
    versions.sort((a, b) => a.lineNumber - b.lineNumber);
    histories.push({ filePath: fp, versions });
  }
  histories.sort((a, b) => b.versions.length - a.versions.length);
  return histories;
}

/**
 * Retrieve the content of a specific file version from a Cline task.
 * `lineNumber` is the message index produced by parseFileHistory above.
 */
export async function getFileContent(apiPath: string, lineNumber: number): Promise<string | null> {
  try {
    const raw = await readFile(apiPath, 'utf-8');
    const messages: ApiMessage[] = JSON.parse(raw);
    if (!Array.isArray(messages) || lineNumber < 0 || lineNumber >= messages.length) return null;

    const msg = messages[lineNumber];
    if (!Array.isArray(msg.content)) return null;

    // Assistant write/edit: pull content straight from input.
    for (const block of msg.content) {
      if (block.type === 'tool_use') {
        const op = fileOpForTool(block.name || '');
        if (op && op !== 'read') {
          const c = contentOfInput(block.input);
          if (c) return c;
        }
      }
    }

    // User tool_result: pull text content (read result).
    for (const block of msg.content) {
      if (block.type === 'tool_result') {
        if (typeof block.content === 'string') return block.content;
        if (Array.isArray(block.content)) {
          const parts: string[] = [];
          for (const c of block.content) {
            if (typeof c === 'object' && c !== null && (c as unknown as Record<string, unknown>).type === 'text') {
              parts.push((c as unknown as Record<string, unknown>).text as string || '');
            }
          }
          if (parts.length > 0) return parts.join('\n');
        }
      }
    }
  } catch {
    // fall through
  }
  return null;
}

export async function parseConversation(apiPath: string): Promise<ClineParsedConversation> {
  const messages: ChatMessage[] = [];
  const timeline: TimelineEvent[] = [];

  try {
    const raw = await readFile(apiPath, 'utf-8');
    const apiMessages: ApiMessage[] = JSON.parse(raw);

    for (let msgIdx = 0; msgIdx < apiMessages.length; msgIdx++) {
      const msg = apiMessages[msgIdx];
      const role = msg.role === 'assistant' ? 'assistant' : 'user';
      const content = msg.content;
      const uuid = `msg-${msgIdx}`;

      let text = '';
      let toolUse: string | undefined;
      let hasImage = false;
      let imageId: string | undefined;

      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            text += (text ? '\n' : '') + block.text;
          } else if (block.type === 'tool_use') {
            toolUse = block.name || 'tool';
            if (block.input) {
              if (block.input.path) toolUse += `: ${block.input.path}`;
              else if (block.input.file_path) toolUse += `: ${block.input.file_path}`;
              else if (block.input.command) toolUse += `: ${String(block.input.command).slice(0, 80)}`;
            }
          } else if (block.type === 'image') {
            hasImage = true;
          }
        }

        // Find image IDs
        if (hasImage) {
          const blobs: Base64Blob[] = [];
          findBase64Blobs(msg, '', blobs);
          if (blobs.length > 0) {
            imageId = `${msgIdx}-${blobs[0].path}`;
          }
        }
      }

      if (text || toolUse || hasImage) {
        messages.push({
          id: uuid,
          role,
          text: text.slice(0, 2000),
          toolUse,
          hasImage,
          imageId,
        });
      }

      // Timeline
      if (role === 'user') {
        const userText = text.split('\n')[0].slice(0, 120);
        if (userText) {
          timeline.push({
            id: uuid,
            type: 'user',
            summary: userText,
            detail: text.length > 120 ? text.slice(0, 1000) : undefined,
          });
        }
        if (hasImage) {
          timeline.push({
            id: `${uuid}-img`,
            type: 'image',
            summary: 'Screenshot shared',
            imageId,
          });
        }
      } else if (Array.isArray(content)) {
        // Extract tool events
        for (const block of content) {
          if (block.type === 'tool_use') {
            const tName = block.name || 'unknown';
            const input = block.input || {};
            const evType = toolNameToEventType(tName);

            let summary = tName;
            let filePath: string | undefined;
            let detail: string | undefined;

            if (input.path || input.file_path) {
              filePath = (input.path || input.file_path) as string;
              summary = `${tName}  ${filePath}`;
            } else if (input.command) {
              const cmd = String(input.command);
              summary = cmd.length > 120 ? cmd.slice(0, 120) + '...' : cmd;
              detail = cmd;
            }

            timeline.push({
              id: `${uuid}-tool-${timeline.length}`,
              type: evType,
              summary,
              detail,
              filePath,
            });
          }
        }

        // Plain text response with no tools
        if (text && !content.some((b: ContentBlock) => b.type === 'tool_use')) {
          timeline.push({
            id: uuid,
            type: 'assistant',
            summary: text.split('\n')[0].slice(0, 120),
            detail: text.length > 120 ? text.slice(0, 1000) : undefined,
          });
        }
      }
    }
  } catch {
    // parse error — return empty
  }

  return { messages, timeline };
}

// ── Secret scanning + redact ────────────────────────────────────────────────

/**
 * Walk the Cline conversation array, scan every text-bearing block for secrets.
 * `lineNumber` on findings is the index in the message array (0-based, +1 for
 * display) — Cline's file is a JSON array, not JSONL, so there's no real line.
 */
export async function scanClineSecrets(apiPath: string): Promise<SecretFinding[]> {
  const findings: SecretFinding[] = [];
  const seen = new Set<string>();
  try {
    const raw = await readFile(apiPath, 'utf-8');
    const messages: ApiMessage[] = JSON.parse(raw);
    for (let i = 0; i < messages.length; i++) {
      const blocks = messages[i].content;
      if (typeof blocks === 'string') {
        findings.push(...scanText(blocks, i + 1, seen));
        continue;
      }
      if (!Array.isArray(blocks)) continue;
      for (const b of blocks) {
        if (b.type === 'text' && typeof b.text === 'string') {
          findings.push(...scanText(b.text, i + 1, seen));
        } else if (b.type === 'tool_use' && b.input) {
          findings.push(...scanText(JSON.stringify(b.input), i + 1, seen));
        } else if (b.type === 'tool_result') {
          if (typeof b.content === 'string') {
            findings.push(...scanText(b.content, i + 1, seen));
          } else if (Array.isArray(b.content)) {
            for (const c of b.content) {
              if (c.type === 'text' && typeof c.text === 'string') {
                findings.push(...scanText(c.text, i + 1, seen));
              }
            }
          }
        }
      }
    }
  } catch { /* parse error */ }
  return sortFindings(findings);
}

/**
 * Rewrite the Cline conversation file in place, redacting matched secrets.
 * `filter.lineNumber` selects a single message (1-based to match findings).
 */
export async function redactClineSecrets(
  apiPath: string,
  filter: RedactFilter | null,
): Promise<{ replaced: number }> {
  const raw = await readFile(apiPath, 'utf-8');
  const messages: ApiMessage[] = JSON.parse(raw);
  let replaced = 0;

  function applyToString(s: string): string {
    const r = redactText(s, filter);
    replaced += r.replaced;
    return r.text;
  }

  for (let i = 0; i < messages.length; i++) {
    if (filter?.lineNumber != null && (i + 1) !== filter.lineNumber) continue;
    const blocks = messages[i].content;
    if (typeof blocks === 'string') {
      messages[i].content = applyToString(blocks);
      continue;
    }
    if (!Array.isArray(blocks)) continue;
    for (const b of blocks) {
      if (b.type === 'text' && typeof b.text === 'string') {
        b.text = applyToString(b.text);
      } else if (b.type === 'tool_use' && b.input) {
        // Round-trip via JSON so we hit values inside the input object.
        const inputStr = applyToString(JSON.stringify(b.input));
        try { b.input = JSON.parse(inputStr); } catch { /* keep original on parse failure */ }
      } else if (b.type === 'tool_result') {
        if (typeof b.content === 'string') {
          b.content = applyToString(b.content);
        } else if (Array.isArray(b.content)) {
          for (const c of b.content) {
            if (c.type === 'text' && typeof c.text === 'string') {
              c.text = applyToString(c.text);
            }
          }
        }
      }
    }
  }

  if (replaced > 0) {
    // Match the original formatting (pretty-printed JSON) to keep diffs sane.
    await import('fs/promises').then(fs => fs.writeFile(apiPath, JSON.stringify(messages, null, 2), 'utf-8'));
  }
  return { replaced };
}

// ── Markdown export ────────────────────────────────────────────────────────

/**
 * Render a Cline conversation as plain markdown. Same shape as Claude's
 * `exportSessionMarkdown`: H1 with the session id, then alternating
 * **User** / **Assistant** sections.
 */
export async function exportClineMarkdown(apiPath: string, taskId: string, taskName: string | null): Promise<string> {
  const out: string[] = [];
  out.push(`# ${taskName ?? taskId}`, '');
  try {
    const raw = await readFile(apiPath, 'utf-8');
    const messages: ApiMessage[] = JSON.parse(raw);
    for (const msg of messages) {
      const heading = msg.role === 'assistant' ? '## Assistant' : '## User';
      out.push(heading, '');
      if (typeof msg.content === 'string') {
        out.push(msg.content, '');
        continue;
      }
      if (!Array.isArray(msg.content)) continue;
      for (const b of msg.content) {
        if (b.type === 'text' && b.text) {
          out.push(b.text, '');
        } else if (b.type === 'tool_use') {
          const name = b.name || 'tool';
          const arg = (b.input?.path || b.input?.file_path || b.input?.command || '') as string;
          out.push(`> *tool: ${name}${arg ? ` — ${arg}` : ''}*`, '');
        } else if (b.type === 'image') {
          out.push('> *(image)*', '');
        } else if (b.type === 'tool_result' && typeof b.content === 'string' && b.content.length < 4000) {
          out.push('```', b.content, '```', '');
        }
      }
    }
  } catch { /* fall through with whatever we have */ }
  return out.join('\n');
}
