import { Session, SessionDetail, SessionImage, ImageData, ChatMessage, TimelineEvent, TimelineEventType } from '../types.js';
import { readFile, stat } from 'fs/promises';
import sharp from 'sharp';

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
    try {
      const metaRaw = await readFile(metaPath, 'utf-8');
      const meta: TaskMetadata = JSON.parse(metaRaw);
      if (meta.task) {
        taskName = meta.task.length > 80 ? meta.task.slice(0, 77) + '...' : meta.task;
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
    try {
      const metaRaw = await readFile(metaPath, 'utf-8');
      const meta: TaskMetadata = JSON.parse(metaRaw);
      if (meta.task) {
        taskName = meta.task.length > 80 ? meta.task.slice(0, 77) + '...' : meta.task;
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
