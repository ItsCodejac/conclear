import { Session, SessionDetail, SessionImage, ImageData, ChatMessage, TimelineEvent, TimelineEventType, FileVersion, FileHistory } from '../types.js';
import { readFile, stat } from 'fs/promises';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { basename } from 'path';
import sharp from 'sharp';

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

interface JsonlLine {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  message?: {
    role?: string;
    content?: unknown[];
  };
  toolUseResult?: Record<string, unknown>;
  customTitle?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
}

/** Branches that don't add useful context as a preview prefix */
const GENERIC_BRANCHES = new Set(['main', 'master', 'HEAD', 'develop', 'dev', 'staging', 'production', 'prod']);

/** Test whether a user message is "substantive" — a real instruction, not a path/UUID/command */
function isSubstantiveMessage(text: string): boolean {
  if (text.length <= 10) return false;
  if (!text.includes(' ')) return false;                           // single-word commands
  if (/^[\/~.]/.test(text)) return false;                         // file paths
  if (/^https?:\/\//.test(text)) return false;                    // URLs
  if (/^[0-9a-f]{8,}[-]?/i.test(text) && !/\s/.test(text.slice(0, 40))) return false; // hex/UUID
  if (!/^[a-zA-Z]/.test(text)) return false;                      // must start with a letter
  return true;
}

function findBase64Blobs(obj: unknown, path: string, results: Array<{ path: string; size: number; mediaType: string }>): void {
  if (obj === null || obj === undefined) return;

  if (typeof obj === 'object' && !Array.isArray(obj)) {
    const record = obj as Record<string, unknown>;

    // Pattern 1: source.data in image blocks
    if (record.type === 'image' && typeof record.source === 'object' && record.source !== null) {
      const source = record.source as Record<string, unknown>;
      if (source.type === 'base64' && typeof source.data === 'string' && source.data.length > 200) {
        results.push({
          path: `${path}.source.data`,
          size: Math.ceil(source.data.length * 0.75),
          mediaType: (source.media_type as string) || 'image/png',
        });
        return;
      }
    }

    // Pattern 2: base64 key directly (toolUseResult.file.base64)
    if (typeof record.base64 === 'string' && record.base64.length > 200) {
      results.push({
        path: `${path}.base64`,
        size: Math.ceil(record.base64.length * 0.75),
        mediaType: 'image/png',
      });
    }

    for (const [key, value] of Object.entries(record)) {
      if (key === 'base64') continue; // already handled
      findBase64Blobs(value, `${path}.${key}`, results);
    }
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      findBase64Blobs(obj[i], `${path}[${i}]`, results);
    }
  }
}

function replaceBase64Blobs(obj: unknown): number {
  if (obj === null || obj === undefined) return 0;
  let replaced = 0;

  if (typeof obj === 'object' && !Array.isArray(obj)) {
    const record = obj as Record<string, unknown>;

    if (record.type === 'image' && typeof record.source === 'object' && record.source !== null) {
      const source = record.source as Record<string, unknown>;
      if (source.type === 'base64' && typeof source.data === 'string' && source.data.length > 200) {
        source.data = TINY_PNG;
        source.media_type = 'image/png';
        replaced++;
        return replaced;
      }
    }

    if (typeof record.base64 === 'string' && record.base64.length > 200) {
      record.base64 = TINY_PNG;
      replaced++;
    }

    for (const [key, value] of Object.entries(record)) {
      if (key === 'base64') continue;
      replaced += replaceBase64Blobs(value);
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      replaced += replaceBase64Blobs(item);
    }
  }

  return replaced;
}

export async function parseSessionFile(filePath: string): Promise<Session | null> {
  try {
    const stats = await stat(filePath);

    // Stream the file line by line — fast scan without loading entire file into memory
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });

    let messageCount = 0;
    let imageCount = 0;
    let imageSizeBytes = 0;
    let sessionName: string | null = null;
    let preview: string | null = null;
    let firstTimestamp: number | null = null;
    let lastTimestamp: number | null = null;

    for await (const line of rl) {
      if (!line.trim()) continue;

      // Fast pre-check: skip full JSON parse for lines without interesting content
      const hasTitle = line.includes('custom-title');
      const hasMessage = line.includes('"user"') || line.includes('"assistant"');
      const hasImage = line.includes('base64');
      const hasTimestamp = line.includes('timestamp');

      if (!hasTitle && !hasMessage && !hasImage && !hasTimestamp) continue;

      try {
        const parsed: JsonlLine = JSON.parse(line);

        if (hasTitle && parsed.type === 'custom-title' && parsed.customTitle) {
          sessionName = parsed.customTitle;
        }

        if (hasMessage && (parsed.type === 'user' || parsed.type === 'assistant')) {
          messageCount++;
        }

        // Extract first user message text as preview
        if (preview === null && parsed.type === 'user' && parsed.message?.content) {
          const content = parsed.message.content;
          let text = '';
          if (typeof content === 'string') {
            text = content;
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (typeof block === 'object' && block !== null && (block as Record<string, unknown>).type === 'text') {
                text = (block as Record<string, unknown>).text as string || '';
                break;
              }
            }
          }
          // Strip system XML tags before using as preview
          text = text.replace(/<(?:system-reminder|local-command-caveat|command-name|command-message|command-args|task-notification|user-prompt-submit-hook|antml:[a-z_]+|env|functions|function)[^>]*>[\s\S]*?<\/(?:system-reminder|local-command-caveat|command-name|command-message|command-args|task-notification|user-prompt-submit-hook|antml:[a-z_]+|env|functions|function)>/gi, '');
          text = text.trim().replace(/\s+/g, ' ');
          if (text.length > 0) {
            preview = text.length > 60 ? text.slice(0, 57) + '...' : text;
          }
        }

        if (hasTimestamp && parsed.timestamp) {
          const ts = new Date(parsed.timestamp).getTime();
          if (!isNaN(ts)) {
            if (firstTimestamp === null || ts < firstTimestamp) firstTimestamp = ts;
            if (lastTimestamp === null || ts > lastTimestamp) lastTimestamp = ts;
          }
        }

        if (hasImage) {
          const blobs: Array<{ path: string; size: number; mediaType: string }> = [];
          findBase64Blobs(parsed, '', blobs);
          imageCount += blobs.length;
          imageSizeBytes += blobs.reduce((sum, b) => sum + b.size, 0);
        }
      } catch {
        // skip unparseable lines
      }
    }

    return {
      id: basename(filePath, '.jsonl'),
      name: sessionName,
      preview,
      project: '',
      tool: 'claude',
      createdAt: firstTimestamp ?? stats.birthtimeMs,
      lastActiveAt: lastTimestamp ?? stats.mtimeMs,
      messageCount,
      imageCount,
      totalSizeBytes: stats.size,
      imageSizeBytes,
      filePath,
    };
  } catch {
    return null;
  }
}

export async function parseSessionDetail(filePath: string): Promise<SessionDetail | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const stats = await stat(filePath);
    const lines = content.split('\n').filter(l => l.trim());

    let messageCount = 0;
    let sessionName: string | null = null;
    let preview: string | null = null;
    let firstTimestamp: number | null = null;
    let lastTimestamp: number | null = null;
    const images: SessionImage[] = [];
    let toolResultSizeBytes = 0;

    // Track the most recent user message text for image context
    let lastUserText = '';

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      try {
        const parsed: JsonlLine = JSON.parse(lines[lineIdx]);

        if (parsed.type === 'custom-title' && parsed.customTitle) {
          sessionName = parsed.customTitle;
        }

        if (parsed.type === 'user' || parsed.type === 'assistant') {
          messageCount++;
        }

        // Extract user message text for preview and image context
        if (parsed.type === 'user' && parsed.message?.content) {
          const content = parsed.message.content;
          let text = '';
          if (typeof content === 'string') {
            text = content;
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (typeof block === 'object' && block !== null && (block as Record<string, unknown>).type === 'text') {
                text += (text ? ' ' : '') + ((block as Record<string, unknown>).text as string || '');
              }
            }
          }
          // Strip system XML tags (task-notification, system-reminder, etc.) before using as context
          text = text.replace(/<(?:system-reminder|local-command-caveat|command-name|command-message|command-args|task-notification|user-prompt-submit-hook|antml:[a-z_]+|env|functions|function)[^>]*>[\s\S]*?<\/(?:system-reminder|local-command-caveat|command-name|command-message|command-args|task-notification|user-prompt-submit-hook|antml:[a-z_]+|env|functions|function)>/gi, '');
          text = text.trim().replace(/\s+/g, ' ');
          if (text.length > 0) {
            lastUserText = text;
            if (preview === null) {
              preview = text.length > 60 ? text.slice(0, 57) + '...' : text;
            }
          }
        }

        if (parsed.timestamp) {
          const ts = new Date(parsed.timestamp).getTime();
          if (!isNaN(ts)) {
            if (firstTimestamp === null || ts < firstTimestamp) firstTimestamp = ts;
            if (lastTimestamp === null || ts > lastTimestamp) lastTimestamp = ts;
          }
        }

        // Find images with context
        const blobs: Array<{ path: string; size: number; mediaType: string }> = [];
        findBase64Blobs(parsed, '', blobs);

        for (const blob of blobs) {
          // Build a rich context label: "3:08 PM -- fix the auth middleware..."
          let context = '';

          // Format timestamp as time label
          if (parsed.timestamp) {
            const d = new Date(parsed.timestamp);
            if (!isNaN(d.getTime())) {
              context = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            }
          }

          // Add the nearby user message text
          const nearbyText = lastUserText.length > 50 ? lastUserText.slice(0, 47) + '...' : lastUserText;
          if (context && nearbyText) {
            context += ' \u2014 ' + nearbyText;
          } else if (nearbyText) {
            context = nearbyText;
          } else if (!context) {
            context = `Image at line ${lineIdx + 1}`;
          } else {
            context = `Screenshot at ${context}`;
          }

          images.push({
            id: `${lineIdx}-${blob.path}`,
            lineNumber: lineIdx + 1,
            sizeBytes: blob.size,
            mediaType: blob.mediaType,
            context,
            timestamp: parsed.timestamp,
          });
        }

        // Estimate tool result sizes (non-image content in toolUseResult)
        if (parsed.toolUseResult) {
          const trStr = JSON.stringify(parsed.toolUseResult);
          toolResultSizeBytes += Buffer.byteLength(trStr, 'utf-8');
        }
      } catch {
        // skip
      }
    }

    const imageSizeBytes = images.reduce((sum, img) => sum + img.sizeBytes, 0);

    return {
      id: basename(filePath, '.jsonl'),
      name: sessionName,
      preview,
      project: '',
      tool: 'claude',
      createdAt: firstTimestamp ?? stats.birthtimeMs,
      lastActiveAt: lastTimestamp ?? stats.mtimeMs,
      messageCount,
      imageCount: images.length,
      totalSizeBytes: stats.size,
      imageSizeBytes,
      filePath,
      images,
      toolResultSizeBytes,
    };
  } catch {
    return null;
  }
}

export function stripImagesFromContent(content: string, imageIds: Set<string> | null): { result: string; stripped: number } {
  const lines = content.split('\n');
  const newLines: string[] = [];
  let stripped = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (!line.trim()) {
      newLines.push(line);
      continue;
    }

    try {
      const parsed = JSON.parse(line);

      // Find blobs to check if any match
      const blobs: Array<{ path: string; size: number; mediaType: string }> = [];
      findBase64Blobs(parsed, '', blobs);

      if (blobs.length > 0) {
        // Check if any of this line's images should be stripped
        const shouldStrip = imageIds === null || blobs.some(b => imageIds.has(`${lineIdx}-${b.path}`));
        if (shouldStrip) {
          stripped += replaceBase64Blobs(parsed);
          newLines.push(JSON.stringify(parsed));
          continue;
        }
      }

      newLines.push(line);
    } catch {
      newLines.push(line);
    }
  }

  return { result: newLines.join('\n'), stripped };
}

async function resizeToTargetSize(data: string, mediaType: string, targetBytes: number): Promise<{ data: string; mediaType: string }> {
  const buffer = Buffer.from(data, 'base64');
  const currentSize = buffer.length;

  // Already under target
  if (currentSize <= targetBytes) {
    return { data, mediaType };
  }

  const meta = await sharp(buffer).metadata();
  if (!meta.width || !meta.height) return { data, mediaType };

  // Iteratively scale down until we hit the target size
  // Start by estimating scale factor from size ratio
  let scale = Math.sqrt(targetBytes / currentSize) * 0.9; // slightly aggressive
  let bestBuffer = buffer;
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

    // Still too big, scale down more
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
      if (source.type === 'base64' && typeof source.data === 'string' && source.data.length > 200) {
        const result = await resizeToTargetSize(source.data as string, (source.media_type as string) || 'image/png', targetBytes);
        if (result.data !== source.data) {
          source.data = result.data;
          source.media_type = result.mediaType;
          resized++;
        }
        return resized;
      }
    }

    if (typeof record.base64 === 'string' && record.base64.length > 200) {
      const result = await resizeToTargetSize(record.base64, 'image/png', targetBytes);
      if (result.data !== record.base64) {
        record.base64 = result.data;
        resized++;
      }
    }

    for (const [key, value] of Object.entries(record)) {
      if (key === 'base64') continue;
      resized += await resizeBase64Blobs(value, targetBytes);
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      resized += await resizeBase64Blobs(item, targetBytes);
    }
  }

  return resized;
}

export async function resizeImagesInContent(
  content: string,
  imageIds: Set<string> | null,
  targetBytes: number,
): Promise<{ result: string; resized: number }> {
  const lines = content.split('\n');
  const newLines: string[] = [];
  let resized = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (!line.trim()) {
      newLines.push(line);
      continue;
    }

    try {
      const parsed = JSON.parse(line);
      const blobs: Array<{ path: string; size: number; mediaType: string }> = [];
      findBase64Blobs(parsed, '', blobs);

      if (blobs.length > 0) {
        const shouldResize = imageIds === null || blobs.some(b => imageIds.has(`${lineIdx}-${b.path}`));
        if (shouldResize) {
          resized += await resizeBase64Blobs(parsed, targetBytes);
          newLines.push(JSON.stringify(parsed));
          continue;
        }
      }

      newLines.push(line);
    } catch {
      newLines.push(line);
    }
  }

  return { result: newLines.join('\n'), resized };
}

function extractBase64AtPath(obj: unknown, targetPath: string, currentPath: string): string | null {
  if (obj === null || obj === undefined) return null;

  if (typeof obj === 'object' && !Array.isArray(obj)) {
    const record = obj as Record<string, unknown>;

    // Check source.data pattern
    if (record.type === 'image' && typeof record.source === 'object' && record.source !== null) {
      const source = record.source as Record<string, unknown>;
      const checkPath = `${currentPath}.source.data`;
      if (checkPath === targetPath && typeof source.data === 'string') {
        return source.data;
      }
    }

    // Check base64 key pattern
    if (typeof record.base64 === 'string') {
      const checkPath = `${currentPath}.base64`;
      if (checkPath === targetPath) {
        return record.base64;
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

export async function getImageData(filePath: string, imageId: string): Promise<ImageData | null> {
  // imageId format: "{lineIndex}-{path}" e.g. "602-.message.content[0].source.data"
  const dashIdx = imageId.indexOf('-');
  if (dashIdx === -1) return null;

  const lineIdx = parseInt(imageId.substring(0, dashIdx), 10);
  const blobPath = imageId.substring(dashIdx + 1);

  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');

  if (lineIdx < 0 || lineIdx >= lines.length) return null;
  const line = lines[lineIdx].trim();
  if (!line) return null;

  try {
    const parsed = JSON.parse(line);
    const base64 = extractBase64AtPath(parsed, blobPath, '');

    if (base64 && base64.length > 200) {
      // Detect media type from base64 header
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

    if (`${currentPath}.base64` === targetPath && 'base64' in record) {
      record.base64 = value;
      return true;
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

export async function restoreImageData(filePath: string, imageId: string, base64: string, mediaType: string): Promise<void> {
  const dashIdx = imageId.indexOf('-');
  if (dashIdx === -1) throw new Error('Invalid image ID');

  const lineIdx = parseInt(imageId.substring(0, dashIdx), 10);
  const blobPath = imageId.substring(dashIdx + 1);

  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');

  if (lineIdx < 0 || lineIdx >= lines.length) throw new Error('Line index out of range');

  const line = lines[lineIdx].trim();
  if (!line) throw new Error('Empty line');

  const parsed = JSON.parse(line);
  const success = setBase64AtPath(parsed, blobPath, '', base64, mediaType);
  if (!success) throw new Error('Could not find image path in line');

  lines[lineIdx] = JSON.stringify(parsed);
  await writeFile(filePath, lines.join('\n'), 'utf-8');
}

/**
 * Strip system-level XML tags from message text.
 * These are injected by Claude's runtime and are not user-visible content.
 * Matches block-level tags like <system-reminder>...</system-reminder>,
 * <local-command-caveat>...</local-command-caveat>, etc.
 * Avoids stripping content inside markdown code fences.
 */
function stripSystemXmlTags(input: string): string {
  const SYSTEM_TAGS = [
    'system-reminder',
    'local-command-caveat',
    'command-name',
    'command-message',
    'command-args',
    'command-stdout',
    'command-stderr',
    'antml:thinking',
    'antml:function_calls',
    'antml:invoke',
    'antml:parameter',
    'env',
    'functions',
    'function',
  ];

  let result = input;
  for (const tag of SYSTEM_TAGS) {
    // Escape any special regex chars in the tag name
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match the full block including nested content (non-greedy across lines)
    const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>` + '[\\s\\S]*?' + `</${escaped}>`, 'g');
    result = result.replace(re, '');
  }

  // Clean up leftover blank lines from removed blocks
  result = result.replace(/\n{3,}/g, '\n\n').trim();
  return result;
}

function extractTextFromContent(content: unknown): { text: string; toolUse?: string; hasImage: boolean; imageId?: string } {
  let text = '';
  let toolUse: string | undefined;
  let hasImage = false;
  let imageId: string | undefined;

  if (typeof content === 'string') {
    return { text: stripSystemXmlTags(content), hasImage: false };
  }

  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'object' && block !== null) {
        const b = block as Record<string, unknown>;
        if (b.type === 'text' && typeof b.text === 'string') {
          text += (text ? '\n' : '') + b.text;
        } else if (b.type === 'tool_use') {
          toolUse = b.name as string;
          if (typeof b.input === 'object' && b.input !== null) {
            const input = b.input as Record<string, unknown>;
            // Show key context for common tools
            if (input.file_path) toolUse += `: ${input.file_path}`;
            else if (input.command) toolUse += `: ${String(input.command).slice(0, 80)}`;
            else if (input.pattern) toolUse += `: ${input.pattern}`;
            else if (input.query) toolUse += `: ${String(input.query).slice(0, 80)}`;
          }
        } else if (b.type === 'tool_result') {
          const resultContent = b.content;
          if (typeof resultContent === 'string') {
            text += (text ? '\n' : '') + resultContent.slice(0, 200);
          }
        } else if (b.type === 'image') {
          hasImage = true;
        } else if (b.type === 'thinking') {
          // skip thinking blocks
        }
      }
    }
  }

  return { text: stripSystemXmlTags(text), toolUse, hasImage, imageId };
}

function toolNameToEventType(toolName: string): TimelineEventType {
  const name = toolName.toLowerCase();
  if (name === 'edit') return 'edit';
  if (name === 'read') return 'read';
  if (name === 'write') return 'write';
  if (name === 'bash') return 'bash';
  if (name === 'grep' || name === 'glob') return 'search';
  if (name === 'agent') return 'agent';
  return 'assistant';
}

function extractToolEvents(content: unknown, timestamp: string | undefined, lineIdx: number): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  if (!Array.isArray(content)) return events;

  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const b = block as Record<string, unknown>;

    if (b.type === 'tool_use') {
      const toolName = (b.name as string) || 'unknown';
      const input = (b.input as Record<string, unknown>) || {};
      const evType = toolNameToEventType(toolName);

      let summary = toolName;
      let filePath: string | undefined;
      let detail: string | undefined;

      if (input.file_path) {
        filePath = input.file_path as string;
        summary = `${toolName}  ${filePath}`;
        if (input.old_string && input.new_string) {
          summary += `  [edit]`;
        }
      } else if (input.command) {
        const cmd = String(input.command);
        summary = cmd.length > 120 ? cmd.slice(0, 120) + '...' : cmd;
        detail = cmd;
      } else if (input.pattern) {
        summary = `${toolName}  ${input.pattern}`;
        if (input.path) summary += `  in ${input.path}`;
      } else if (input.query) {
        summary = `${toolName}  ${String(input.query).slice(0, 100)}`;
      } else if (input.prompt) {
        summary = `Agent: ${String(input.prompt).slice(0, 100)}`;
      }

      events.push({
        id: `${lineIdx}-tool-${events.length}`,
        type: evType,
        timestamp,
        summary,
        detail,
        filePath,
      });
    }
  }

  return events;
}

export interface ParsedConversation {
  messages: ChatMessage[];
  timeline: TimelineEvent[];
}

export async function parseConversation(filePath: string): Promise<ParsedConversation> {
  const messages: ChatMessage[] = [];
  const timeline: TimelineEvent[] = [];

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let lineIdx = 0;
  for await (const line of rl) {
    if (!line.trim()) { lineIdx++; continue; }

    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const type = parsed.type as string;
      const timestamp = parsed.timestamp as string | undefined;
      const uuid = (parsed.uuid as string) || `line-${lineIdx}`;

      // System events (turn duration)
      if (type === 'system') {
        const subtype = parsed.subtype as string;
        if (subtype === 'turn_duration') {
          const ms = parsed.durationMs as number;
          if (ms) {
            timeline.push({
              id: uuid,
              type: 'assistant',
              timestamp,
              summary: `Turn completed`,
              durationMs: ms,
            });
          }
        }
        lineIdx++;
        continue;
      }

      if (type !== 'user' && type !== 'assistant') {
        lineIdx++;
        continue;
      }

      const message = parsed.message as Record<string, unknown> | undefined;
      if (!message) { lineIdx++; continue; }

      const role = (message.role as string) === 'assistant' ? 'assistant' : 'user';
      const content = message.content;
      const { text, toolUse, hasImage } = extractTextFromContent(content);

      // Find image IDs on this line
      let imageId: string | undefined;
      if (hasImage) {
        const blobs: Array<{ path: string; size: number; mediaType: string }> = [];
        findBase64Blobs(parsed, '', blobs);
        if (blobs.length > 0) {
          imageId = `${lineIdx}-${blobs[0].path}`;
        }
      }

      // Chat message
      if (text || toolUse || hasImage) {
        messages.push({
          id: uuid,
          role,
          timestamp,
          text: text.slice(0, 2000),
          toolUse,
          hasImage,
          imageId,
        });
      }

      // Timeline events
      if (role === 'user') {
        const userText = text.split('\n')[0].slice(0, 120);
        if (userText) {
          timeline.push({
            id: uuid,
            type: 'user',
            timestamp,
            summary: userText,
            detail: text.length > 120 ? text.slice(0, 1000) : undefined,
          });
        }
        if (hasImage) {
          timeline.push({
            id: `${uuid}-img`,
            type: 'image',
            timestamp,
            summary: 'Screenshot shared',
            imageId,
          });
        }
      } else {
        // Assistant: extract tool calls as individual timeline events
        const toolEvents = extractToolEvents(content, timestamp, lineIdx);
        timeline.push(...toolEvents);

        // If there's text but no tools, it's a text response
        if (text && toolEvents.length === 0) {
          timeline.push({
            id: uuid,
            type: 'assistant',
            timestamp,
            summary: text.split('\n')[0].slice(0, 120),
            detail: text.length > 120 ? text.slice(0, 1000) : undefined,
          });
        }
      }

      // Check tool results for errors (in user messages that contain tool_result)
      if (role === 'user' && Array.isArray(content)) {
        for (const block of content) {
          if (typeof block === 'object' && block !== null) {
            const b = block as Record<string, unknown>;
            if (b.type === 'tool_result' && b.is_error) {
              const errText = typeof b.content === 'string' ? b.content.slice(0, 200) : 'Error';
              timeline.push({
                id: `${uuid}-err`,
                type: 'error',
                timestamp,
                summary: errText.split('\n')[0],
                detail: errText,
              });
            }
          }
        }
      }
    } catch {
      // skip
    }
    lineIdx++;
  }

  return { messages, timeline };
}
