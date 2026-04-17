import { Session, SessionDetail, SessionImage, ImageData, ChatMessage, TimelineEvent, TimelineEventType, FileVersion, FileHistory } from '../types.js';
import { readFile, writeFile, stat } from 'fs/promises';
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

interface Base64Blob {
  path: string;
  size: number;
  mediaType: string;
  /** First ~1000 chars of base64 data for dimension sniffing (only populated when collectHeaders is true) */
  headerData?: string;
}

function findBase64Blobs(obj: unknown, path: string, results: Base64Blob[], collectHeaders = false): void {
  if (obj === null || obj === undefined) return;

  if (typeof obj === 'object' && !Array.isArray(obj)) {
    const record = obj as Record<string, unknown>;

    // Pattern 1: source.data in image blocks
    if (record.type === 'image' && typeof record.source === 'object' && record.source !== null) {
      const source = record.source as Record<string, unknown>;
      if (source.type === 'base64' && typeof source.data === 'string' && source.data.length > 200) {
        const blob: Base64Blob = {
          path: `${path}.source.data`,
          size: Math.ceil(source.data.length * 0.75),
          mediaType: (source.media_type as string) || 'image/png',
        };
        if (collectHeaders) blob.headerData = (source.data as string).slice(0, 1000);
        results.push(blob);
        return;
      }
    }

    // Pattern 2: base64 key directly (toolUseResult.file.base64)
    if (typeof record.base64 === 'string' && record.base64.length > 200) {
      const blob: Base64Blob = {
        path: `${path}.base64`,
        size: Math.ceil(record.base64.length * 0.75),
        mediaType: 'image/png',
      };
      if (collectHeaders) blob.headerData = (record.base64 as string).slice(0, 1000);
      results.push(blob);
    }

    for (const [key, value] of Object.entries(record)) {
      if (key === 'base64') continue; // already handled
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
    // Check PNG magic: 0x89504E47
    if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      if (width > 0 && width < 100000 && height > 0 && height < 100000) {
        return { width, height };
      }
    }

    // JPEG or other formats: use sharp metadata on the header bytes
    // sharp can read dimensions from just the header
    const meta = await sharp(buf).metadata();
    if (meta.width && meta.height) {
      return { width: meta.width, height: meta.height };
    }
  } catch {
    // header too small or not a valid image — skip
  }
  return null;
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
    let firstSubstantivePreview: string | null = null;
    let firstAnyPreview: string | null = null;
    let gitBranch: string | null = null;
    let cwd: string | null = null;
    let firstTimestamp: number | null = null;
    let lastTimestamp: number | null = null;
    const imageHeaders: string[] = []; // base64 header snippets for dimension checking

    for await (const line of rl) {
      if (!line.trim()) continue;

      // Fast pre-check: skip full JSON parse for lines without interesting content
      const hasTitle = line.includes('custom-title');
      const hasMessage = line.includes('"user"') || line.includes('"assistant"');
      const hasImage = line.includes('base64');
      const hasTimestamp = line.includes('timestamp');
      const hasBranch = line.includes('gitBranch');
      const hasCwd = line.includes('"cwd"');

      if (!hasTitle && !hasMessage && !hasImage && !hasTimestamp && !hasBranch && !hasCwd) continue;

      try {
        const parsed: JsonlLine = JSON.parse(line);

        if (hasTitle && parsed.type === 'custom-title' && parsed.customTitle) {
          sessionName = parsed.customTitle;
        }

        if (hasMessage && (parsed.type === 'user' || parsed.type === 'assistant')) {
          messageCount++;
        }

        // Extract gitBranch and cwd from the first line that has them
        if (gitBranch === null && hasBranch && parsed.gitBranch) {
          gitBranch = parsed.gitBranch;
        }
        if (cwd === null && hasCwd && parsed.cwd) {
          cwd = parsed.cwd;
        }

        // Extract user message text candidates for preview (keep scanning until we find a substantive one)
        if (firstSubstantivePreview === null && parsed.type === 'user' && parsed.message?.content) {
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
            // Keep the very first message as a last-resort fallback
            if (firstAnyPreview === null) {
              firstAnyPreview = text.length > 60 ? text.slice(0, 57) + '...' : text;
            }
            // Prefer a substantive message (real instruction, not a path/UUID/single-word)
            if (isSubstantiveMessage(text)) {
              firstSubstantivePreview = text.length > 60 ? text.slice(0, 57) + '...' : text;
            }
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
          const blobs: Base64Blob[] = [];
          findBase64Blobs(parsed, '', blobs, true);
          imageCount += blobs.length;
          imageSizeBytes += blobs.reduce((sum, b) => sum + b.size, 0);
          for (const b of blobs) {
            if (b.headerData) imageHeaders.push(b.headerData);
          }
        }
      } catch {
        // skip unparseable lines
      }
    }

    // Build preview with fallback chain:
    // 1. Resume name (sessionName) — handled separately as `name`
    // 2. Substantive user message, optionally prefixed with descriptive git branch
    // 3. Any first user message (even paths/UUIDs), optionally prefixed with branch
    // 4. Working directory basename
    let preview: string | null = firstSubstantivePreview ?? firstAnyPreview;

    // Prefix with git branch if it's descriptive (not main/master/etc.)
    if (preview && gitBranch && !GENERIC_BRANCHES.has(gitBranch)) {
      const branchPrefix = gitBranch.length > 30 ? gitBranch.slice(0, 27) + '...' : gitBranch;
      const combined = `${branchPrefix}: ${preview}`;
      preview = combined.length > 60 ? combined.slice(0, 57) + '...' : combined;
    }

    // If still no preview, fall back to the working directory basename
    if (!preview && cwd) {
      const dirName = basename(cwd);
      if (dirName && dirName !== '/' && dirName !== '~') {
        preview = dirName;
      }
    }

    // Check image dimensions only when session has 2+ images (the trigger condition)
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
      hasOversizedImages,
      maxImageDimension,
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
    let firstSubstantivePreview: string | null = null;
    let firstAnyPreview: string | null = null;
    let gitBranch: string | null = null;
    let cwd: string | null = null;
    let firstTimestamp: number | null = null;
    let lastTimestamp: number | null = null;
    const images: SessionImage[] = [];
    const imageHeaders: string[] = [];
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

        // Extract gitBranch and cwd from the first line that has them
        if (gitBranch === null && parsed.gitBranch) {
          gitBranch = parsed.gitBranch;
        }
        if (cwd === null && parsed.cwd) {
          cwd = parsed.cwd;
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
            if (firstAnyPreview === null) {
              firstAnyPreview = text.length > 60 ? text.slice(0, 57) + '...' : text;
            }
            if (firstSubstantivePreview === null && isSubstantiveMessage(text)) {
              firstSubstantivePreview = text.length > 60 ? text.slice(0, 57) + '...' : text;
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
        const blobs: Base64Blob[] = [];
        findBase64Blobs(parsed, '', blobs, true);

        for (const blob of blobs) {
          if (blob.headerData) imageHeaders.push(blob.headerData);

          // Build a rich context label: "15:08 -- fix the auth middleware..."
          let context = '';

          // Format timestamp as 24h time label
          if (parsed.timestamp) {
            const d = new Date(parsed.timestamp);
            if (!isNaN(d.getTime())) {
              const hh = String(d.getHours()).padStart(2, '0');
              const mm = String(d.getMinutes()).padStart(2, '0');
              context = `${hh}:${mm}`;
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

    // Build preview with fallback chain (same as parseSessionFile)
    let preview: string | null = firstSubstantivePreview ?? firstAnyPreview;

    if (preview && gitBranch && !GENERIC_BRANCHES.has(gitBranch)) {
      const branchPrefix = gitBranch.length > 30 ? gitBranch.slice(0, 27) + '...' : gitBranch;
      const combined = `${branchPrefix}: ${preview}`;
      preview = combined.length > 60 ? combined.slice(0, 57) + '...' : combined;
    }

    if (!preview && cwd) {
      const dirName = basename(cwd);
      if (dirName && dirName !== '/' && dirName !== '~') {
        preview = dirName;
      }
    }

    // Check image dimensions only when session has 2+ images
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
      hasOversizedImages,
      maxImageDimension,
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

/**
 * Extract file version history from a JSONL session file.
 * Scans assistant tool_use blocks (for operation type & file path) and
 * user tool_result blocks (for file content) as well as top-level toolUseResult entries.
 */
export async function parseFileHistory(filePath: string): Promise<FileHistory[]> {
  const fileVersions = new Map<string, FileVersion[]>();

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  // Track pending tool_use calls by tool_use_id so we can match them to results
  const pendingTools = new Map<string, { operation: 'read' | 'edit' | 'write'; filePath: string; timestamp?: string }>();

  let lineIdx = 0;
  for await (const line of rl) {
    if (!line.trim()) { lineIdx++; continue; }

    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const type = parsed.type as string;
      const timestamp = parsed.timestamp as string | undefined;

      // Assistant messages: extract tool_use blocks to learn operation + file path
      if (type === 'assistant') {
        const message = parsed.message as Record<string, unknown> | undefined;
        if (message && Array.isArray(message.content)) {
          for (const block of message.content) {
            if (typeof block !== 'object' || block === null) continue;
            const b = block as Record<string, unknown>;
            if (b.type !== 'tool_use') continue;

            const toolName = (b.name as string || '').toLowerCase();
            const input = (b.input as Record<string, unknown>) || {};
            const toolUseId = b.id as string;

            if ((toolName === 'read' || toolName === 'edit' || toolName === 'write') && input.file_path) {
              const fp = input.file_path as string;
              const op = toolName as 'read' | 'edit' | 'write';

              if (toolUseId) {
                pendingTools.set(toolUseId, { operation: op, filePath: fp, timestamp });
              }

              // For Edit tool, we can extract content from old_string/new_string
              if (op === 'edit' && (input.old_string || input.new_string)) {
                const editContent = `--- old ---\n${input.old_string || ''}\n--- new ---\n${input.new_string || ''}`;
                const contentBytes = Buffer.byteLength(editContent, 'utf-8');
                const lines = editContent.split('\n').length;
                const version: FileVersion = {
                  filePath: fp,
                  timestamp,
                  operation: 'edit',
                  contentPreview: editContent.slice(0, 200),
                  lineCount: lines,
                  sizeBytes: contentBytes,
                  lineNumber: lineIdx,
                };
                if (!fileVersions.has(fp)) fileVersions.set(fp, []);
                fileVersions.get(fp)!.push(version);
              }

              // For Write tool, the content is in input.content
              if (op === 'write' && typeof input.content === 'string') {
                const writeContent = input.content;
                const contentBytes = Buffer.byteLength(writeContent, 'utf-8');
                const lines = writeContent.split('\n').length;
                const version: FileVersion = {
                  filePath: fp,
                  timestamp,
                  operation: 'write',
                  contentPreview: writeContent.slice(0, 200),
                  lineCount: lines,
                  sizeBytes: contentBytes,
                  lineNumber: lineIdx,
                };
                if (!fileVersions.has(fp)) fileVersions.set(fp, []);
                fileVersions.get(fp)!.push(version);
              }
            }
          }
        }
      }

      // User messages: contain tool_result blocks with file content
      if (type === 'user') {
        const message = parsed.message as Record<string, unknown> | undefined;
        if (message && Array.isArray(message.content)) {
          for (const block of message.content) {
            if (typeof block !== 'object' || block === null) continue;
            const b = block as Record<string, unknown>;
            if (b.type !== 'tool_result') continue;

            const toolUseId = b.tool_use_id as string;
            const pending = toolUseId ? pendingTools.get(toolUseId) : undefined;

            // Extract text content from the tool result
            let resultText = '';
            if (typeof b.content === 'string') {
              resultText = b.content;
            } else if (Array.isArray(b.content)) {
              for (const c of b.content) {
                if (typeof c === 'object' && c !== null && (c as Record<string, unknown>).type === 'text') {
                  resultText += (resultText ? '\n' : '') + ((c as Record<string, unknown>).text as string || '');
                }
              }
            }

            if (pending && pending.operation === 'read' && resultText.length > 0) {
              // Read result: the content is the file content (often with line numbers)
              const contentBytes = Buffer.byteLength(resultText, 'utf-8');
              const lines = resultText.split('\n').length;
              const version: FileVersion = {
                filePath: pending.filePath,
                timestamp: timestamp || pending.timestamp,
                operation: 'read',
                contentPreview: resultText.slice(0, 200),
                lineCount: lines,
                sizeBytes: contentBytes,
                lineNumber: lineIdx,
              };
              if (!fileVersions.has(pending.filePath)) fileVersions.set(pending.filePath, []);
              fileVersions.get(pending.filePath)!.push(version);
            }

            if (pending) {
              pendingTools.delete(toolUseId);
            }
          }
        }
      }

      // Top-level toolUseResult entries (some JSONL formats use this pattern)
      if (parsed.toolUseResult && typeof parsed.toolUseResult === 'object') {
        const tr = parsed.toolUseResult as Record<string, unknown>;
        const fp = tr.filePath as string;
        if (fp) {
          let content = '';
          let operation: 'read' | 'edit' | 'write' = 'read';

          if (typeof tr.content === 'string') {
            content = tr.content;
          }
          if (tr.originalFile && typeof tr.originalFile === 'string') {
            content = tr.originalFile;
            operation = 'edit';
          }
          if (tr.newString || tr.oldString) {
            operation = 'edit';
            if (!content) {
              content = `--- old ---\n${tr.oldString || ''}\n--- new ---\n${tr.newString || ''}`;
            }
          }

          if (content.length > 0) {
            const contentBytes = Buffer.byteLength(content, 'utf-8');
            const lines = content.split('\n').length;
            const version: FileVersion = {
              filePath: fp,
              timestamp,
              operation,
              contentPreview: content.slice(0, 200),
              lineCount: lines,
              sizeBytes: contentBytes,
              lineNumber: lineIdx,
            };
            if (!fileVersions.has(fp)) fileVersions.set(fp, []);
            fileVersions.get(fp)!.push(version);
          }
        }
      }
    } catch {
      // skip unparseable lines
    }
    lineIdx++;
  }

  // Build sorted FileHistory array
  const histories: FileHistory[] = [];
  for (const [fp, versions] of fileVersions) {
    // Sort versions by timestamp if available, otherwise by line number
    versions.sort((a, b) => {
      if (a.timestamp && b.timestamp) return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      return a.lineNumber - b.lineNumber;
    });
    histories.push({ filePath: fp, versions });
  }

  // Sort files by number of versions descending
  histories.sort((a, b) => b.versions.length - a.versions.length);

  return histories;
}

/**
 * Read a specific line from a JSONL file and extract the file content from it.
 * Used to fetch full file content on demand for the file version viewer.
 */
export async function getFileContent(filePath: string, lineNumber: number): Promise<string | null> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let lineIdx = 0;
  for await (const line of rl) {
    if (lineIdx === lineNumber) {
      rl.close();
      if (!line.trim()) return null;

      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;

        // Check assistant tool_use blocks for Edit old_string/new_string or Write content
        if (parsed.message && typeof parsed.message === 'object') {
          const message = parsed.message as Record<string, unknown>;
          if (Array.isArray(message.content)) {
            for (const block of message.content) {
              if (typeof block !== 'object' || block === null) continue;
              const b = block as Record<string, unknown>;
              if (b.type === 'tool_use') {
                const input = (b.input as Record<string, unknown>) || {};
                const toolName = (b.name as string || '').toLowerCase();

                // Write tool: full content in input.content
                if (toolName === 'write' && typeof input.content === 'string') {
                  return input.content;
                }

                // Edit tool: old_string/new_string diff
                if (toolName === 'edit' && (input.old_string || input.new_string)) {
                  return `--- old ---\n${input.old_string || ''}\n--- new ---\n${input.new_string || ''}`;
                }
              }

              // tool_result blocks in user messages
              if (b.type === 'tool_result') {
                let resultText = '';
                if (typeof b.content === 'string') {
                  resultText = b.content;
                } else if (Array.isArray(b.content)) {
                  for (const c of b.content) {
                    if (typeof c === 'object' && c !== null && (c as Record<string, unknown>).type === 'text') {
                      resultText += (resultText ? '\n' : '') + ((c as Record<string, unknown>).text as string || '');
                    }
                  }
                }
                if (resultText.length > 0) return resultText;
              }
            }
          }
        }

        // Top-level toolUseResult
        if (parsed.toolUseResult && typeof parsed.toolUseResult === 'object') {
          const tr = parsed.toolUseResult as Record<string, unknown>;
          if (typeof tr.content === 'string') return tr.content;
          if (typeof tr.originalFile === 'string') return tr.originalFile;
          if (tr.oldString || tr.newString) {
            return `--- old ---\n${tr.oldString || ''}\n--- new ---\n${tr.newString || ''}`;
          }
        }
      } catch {
        return null;
      }
      return null;
    }
    lineIdx++;
  }

  return null;
}
