import { Session, SessionDetail, SessionImage, ImageData, ChatMessage, TimelineEvent, SecretFinding } from '../types.js';
import { readFile, writeFile, stat } from 'fs/promises';
import { basename } from 'path';
import { scanText, redactText, sortFindings, type RedactFilter } from '../secrets.js';

/**
 * Gemini CLI session JSON format:
 * {
 *   sessionId: string,
 *   projectHash: string,
 *   startTime: string (ISO),
 *   lastUpdated: string (ISO),
 *   messages: [
 *     { id: string, timestamp: string, type: 'user'|'gemini'|'info', content: string|object }
 *   ],
 *   kind?: string
 * }
 */

interface GeminiMessage {
  id: string;
  timestamp: string;
  type: 'user' | 'gemini' | 'info';
  content: unknown; // string or structured object
}

interface GeminiSessionJson {
  sessionId: string;
  projectHash?: string;
  startTime?: string;
  lastUpdated?: string;
  messages?: GeminiMessage[];
  kind?: string;
}

/** Extract plain text from a Gemini message content field */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';

  if (typeof content === 'object' && !Array.isArray(content)) {
    const rec = content as Record<string, unknown>;
    // Could have a text field or parts array
    if (typeof rec.text === 'string') return rec.text;
    if (Array.isArray(rec.parts)) {
      return rec.parts
        .map((p: unknown) => {
          if (typeof p === 'string') return p;
          if (typeof p === 'object' && p !== null && typeof (p as Record<string, unknown>).text === 'string') {
            return (p as Record<string, unknown>).text as string;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
  }

  if (Array.isArray(content)) {
    return content
      .map((item: unknown) => extractText(item))
      .filter(Boolean)
      .join('\n');
  }

  return '';
}

/** Find inline base64 image data in message content */
function findInlineImages(content: unknown, path: string, results: Array<{ path: string; size: number; mediaType: string }>): void {
  if (content === null || content === undefined) return;

  if (typeof content === 'object' && !Array.isArray(content)) {
    const rec = content as Record<string, unknown>;

    // Pattern: inlineData.data with mimeType
    if (rec.inlineData && typeof rec.inlineData === 'object') {
      const inline = rec.inlineData as Record<string, unknown>;
      if (typeof inline.data === 'string' && inline.data.length > 200) {
        results.push({
          path: `${path}.inlineData.data`,
          size: Math.ceil(inline.data.length * 0.75),
          mediaType: (inline.mimeType as string) || 'image/png',
        });
        return;
      }
    }

    // Pattern: direct base64 field
    if (typeof rec.base64 === 'string' && rec.base64.length > 200) {
      results.push({
        path: `${path}.base64`,
        size: Math.ceil(rec.base64.length * 0.75),
        mediaType: (rec.mimeType as string) || (rec.mediaType as string) || 'image/png',
      });
    }

    // Pattern: image type with source.data (similar to Claude)
    if (rec.type === 'image' && typeof rec.source === 'object' && rec.source !== null) {
      const source = rec.source as Record<string, unknown>;
      if (source.type === 'base64' && typeof source.data === 'string' && source.data.length > 200) {
        results.push({
          path: `${path}.source.data`,
          size: Math.ceil(source.data.length * 0.75),
          mediaType: (source.media_type as string) || 'image/png',
        });
        return;
      }
    }

    for (const [key, value] of Object.entries(rec)) {
      if (key === 'base64' || key === 'inlineData') continue;
      findInlineImages(value, `${path}.${key}`, results);
    }
  } else if (Array.isArray(content)) {
    for (let i = 0; i < content.length; i++) {
      findInlineImages(content[i], `${path}[${i}]`, results);
    }
  }
}

/** Extract base64 data from a specific path in the session JSON */
function extractBase64AtPath(obj: unknown, targetPath: string, currentPath: string): { data: string; mediaType: string } | null {
  if (obj === null || obj === undefined) return null;

  if (typeof obj === 'object' && !Array.isArray(obj)) {
    const rec = obj as Record<string, unknown>;

    // inlineData pattern
    if (rec.inlineData && typeof rec.inlineData === 'object') {
      const inline = rec.inlineData as Record<string, unknown>;
      if (`${currentPath}.inlineData.data` === targetPath && typeof inline.data === 'string') {
        return { data: inline.data, mediaType: (inline.mimeType as string) || 'image/png' };
      }
    }

    // base64 field
    if (typeof rec.base64 === 'string' && `${currentPath}.base64` === targetPath) {
      return { data: rec.base64, mediaType: (rec.mimeType as string) || (rec.mediaType as string) || 'image/png' };
    }

    // source.data pattern
    if (rec.type === 'image' && typeof rec.source === 'object' && rec.source !== null) {
      const source = rec.source as Record<string, unknown>;
      if (`${currentPath}.source.data` === targetPath && typeof source.data === 'string') {
        return { data: source.data, mediaType: (source.media_type as string) || 'image/png' };
      }
    }

    for (const [key, value] of Object.entries(rec)) {
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

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Replace base64 blobs in the parsed JSON with a tiny placeholder */
function replaceBase64Blobs(obj: unknown): number {
  if (obj === null || obj === undefined) return 0;
  let replaced = 0;

  if (typeof obj === 'object' && !Array.isArray(obj)) {
    const rec = obj as Record<string, unknown>;

    if (rec.inlineData && typeof rec.inlineData === 'object') {
      const inline = rec.inlineData as Record<string, unknown>;
      if (typeof inline.data === 'string' && inline.data.length > 200) {
        inline.data = TINY_PNG;
        inline.mimeType = 'image/png';
        replaced++;
        return replaced;
      }
    }

    if (rec.type === 'image' && typeof rec.source === 'object' && rec.source !== null) {
      const source = rec.source as Record<string, unknown>;
      if (source.type === 'base64' && typeof source.data === 'string' && source.data.length > 200) {
        source.data = TINY_PNG;
        source.media_type = 'image/png';
        replaced++;
        return replaced;
      }
    }

    if (typeof rec.base64 === 'string' && rec.base64.length > 200) {
      rec.base64 = TINY_PNG;
      replaced++;
    }

    for (const [key, value] of Object.entries(rec)) {
      if (key === 'base64' || key === 'inlineData') continue;
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
    const raw = await readFile(filePath, 'utf-8');
    const data: GeminiSessionJson = JSON.parse(raw);

    if (!data.sessionId && !data.messages) return null;

    const messages = data.messages || [];
    const messageCount = messages.filter(m => m.type === 'user' || m.type === 'gemini').length;

    // Count images
    let imageCount = 0;
    let imageSizeBytes = 0;
    for (const msg of messages) {
      const blobs: Array<{ path: string; size: number; mediaType: string }> = [];
      findInlineImages(msg.content, '', blobs);
      imageCount += blobs.length;
      imageSizeBytes += blobs.reduce((sum, b) => sum + b.size, 0);
    }

    // Preview: first user message text
    let preview: string | null = null;
    for (const msg of messages) {
      if (msg.type === 'user') {
        const text = extractText(msg.content).trim().replace(/\s+/g, ' ');
        if (text.length > 0) {
          preview = text.length > 60 ? text.slice(0, 57) + '...' : text;
          break;
        }
      }
    }

    // Timestamps
    const startTime = data.startTime ? new Date(data.startTime).getTime() : stats.birthtimeMs;
    const lastUpdated = data.lastUpdated ? new Date(data.lastUpdated).getTime() : stats.mtimeMs;

    // Derive project name from projectHash or parent directory name
    const project = data.projectHash || basename(filePath, '.json');

    return {
      id: data.sessionId || basename(filePath, '.json'),
      name: null,
      preview,
      project,
      tool: 'gemini',
      createdAt: isNaN(startTime) ? stats.birthtimeMs : startTime,
      lastActiveAt: isNaN(lastUpdated) ? stats.mtimeMs : lastUpdated,
      messageCount,
      imageCount,
      totalSizeBytes: stats.size,
      imageSizeBytes,
      filePath,
      hasOversizedImages: false,
      maxImageDimension: 0,
    };
  } catch {
    return null;
  }
}

export async function parseSessionDetail(filePath: string): Promise<SessionDetail | null> {
  try {
    const stats = await stat(filePath);
    const raw = await readFile(filePath, 'utf-8');
    const data: GeminiSessionJson = JSON.parse(raw);

    if (!data.sessionId && !data.messages) return null;

    const messages = data.messages || [];
    const messageCount = messages.filter(m => m.type === 'user' || m.type === 'gemini').length;

    const images: SessionImage[] = [];
    let toolResultSizeBytes = 0;
    let lastUserText = '';

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.type === 'user') {
        lastUserText = extractText(msg.content).trim().replace(/\s+/g, ' ');
      }

      // Find images
      const blobs: Array<{ path: string; size: number; mediaType: string }> = [];
      findInlineImages(msg.content, '', blobs);

      for (const blob of blobs) {
        let context = '';
        if (msg.timestamp) {
          const d = new Date(msg.timestamp);
          if (!isNaN(d.getTime())) {
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            context = `${hh}:${mm}`;
          }
        }
        const nearbyText = lastUserText.length > 50 ? lastUserText.slice(0, 47) + '...' : lastUserText;
        if (context && nearbyText) {
          context += ' \u2014 ' + nearbyText;
        } else if (nearbyText) {
          context = nearbyText;
        } else if (!context) {
          context = `Image in message ${i + 1}`;
        } else {
          context = `Screenshot at ${context}`;
        }

        images.push({
          id: `msg-${i}-${blob.path}`,
          lineNumber: i,
          sizeBytes: blob.size,
          mediaType: blob.mediaType,
          context,
          timestamp: msg.timestamp,
        });
      }

      // Estimate tool result size for gemini/info messages (tool outputs)
      if (msg.type === 'info' || msg.type === 'gemini') {
        const text = extractText(msg.content);
        if (text.length > 500) {
          toolResultSizeBytes += Buffer.byteLength(text, 'utf-8');
        }
      }
    }

    const imageSizeBytes = images.reduce((sum, img) => sum + img.sizeBytes, 0);

    // Preview
    let preview: string | null = null;
    for (const msg of messages) {
      if (msg.type === 'user') {
        const text = extractText(msg.content).trim().replace(/\s+/g, ' ');
        if (text.length > 0) {
          preview = text.length > 60 ? text.slice(0, 57) + '...' : text;
          break;
        }
      }
    }

    const startTime = data.startTime ? new Date(data.startTime).getTime() : stats.birthtimeMs;
    const lastUpdated = data.lastUpdated ? new Date(data.lastUpdated).getTime() : stats.mtimeMs;
    const project = data.projectHash || basename(filePath, '.json');

    return {
      id: data.sessionId || basename(filePath, '.json'),
      name: null,
      preview,
      project,
      tool: 'gemini',
      createdAt: isNaN(startTime) ? stats.birthtimeMs : startTime,
      lastActiveAt: isNaN(lastUpdated) ? stats.mtimeMs : lastUpdated,
      messageCount,
      imageCount: images.length,
      totalSizeBytes: stats.size,
      imageSizeBytes,
      filePath,
      hasOversizedImages: false,
      maxImageDimension: 0,
      images,
      toolResultSizeBytes,
    };
  } catch {
    return null;
  }
}

export async function getImageData(filePath: string, imageId: string): Promise<ImageData | null> {
  try {
    // imageId format: "msg-{msgIndex}-{path}" e.g. "msg-3-.inlineData.data"
    const match = imageId.match(/^msg-(\d+)-(.+)$/);
    if (!match) return null;

    const msgIdx = parseInt(match[1], 10);
    const blobPath = match[2];

    const raw = await readFile(filePath, 'utf-8');
    const data: GeminiSessionJson = JSON.parse(raw);
    const messages = data.messages || [];

    if (msgIdx < 0 || msgIdx >= messages.length) return null;

    const result = extractBase64AtPath(messages[msgIdx].content, blobPath, '');
    if (result && result.data.length > 200) {
      return { base64: result.data, mediaType: result.mediaType };
    }
  } catch {
    // parse error
  }
  return null;
}

export function stripImagesFromSession(raw: string, imageIds: Set<string> | null): { result: string; stripped: number } {
  try {
    const data: GeminiSessionJson = JSON.parse(raw);
    const messages = data.messages || [];
    let stripped = 0;

    for (let i = 0; i < messages.length; i++) {
      const blobs: Array<{ path: string; size: number; mediaType: string }> = [];
      findInlineImages(messages[i].content, '', blobs);

      if (blobs.length > 0) {
        const shouldStrip = imageIds === null || blobs.some(b => imageIds.has(`msg-${i}-${b.path}`));
        if (shouldStrip) {
          stripped += replaceBase64Blobs(messages[i].content);
        }
      }
    }

    return { result: JSON.stringify(data, null, 2), stripped };
  } catch {
    return { result: raw, stripped: 0 };
  }
}

export function restoreImageInSession(raw: string, imageId: string, base64: string, mediaType: string): string {
  const match = imageId.match(/^msg-(\d+)-(.+)$/);
  if (!match) throw new Error('Invalid image ID');

  const msgIdx = parseInt(match[1], 10);
  const blobPath = match[2];

  const data: GeminiSessionJson = JSON.parse(raw);
  const messages = data.messages || [];

  if (msgIdx < 0 || msgIdx >= messages.length) throw new Error('Message index out of range');

  // Walk the path and set the data
  // We need to reverse-engineer the path to set the value
  const msg = messages[msgIdx];
  if (!setBase64AtPath(msg.content, blobPath, '', base64, mediaType)) {
    throw new Error('Could not find image path in message');
  }

  return JSON.stringify(data, null, 2);
}

function setBase64AtPath(obj: unknown, targetPath: string, currentPath: string, value: string, mediaType: string): boolean {
  if (obj === null || obj === undefined) return false;

  if (typeof obj === 'object' && !Array.isArray(obj)) {
    const rec = obj as Record<string, unknown>;

    if (rec.inlineData && typeof rec.inlineData === 'object') {
      const inline = rec.inlineData as Record<string, unknown>;
      if (`${currentPath}.inlineData.data` === targetPath) {
        inline.data = value;
        inline.mimeType = mediaType;
        return true;
      }
    }

    if (`${currentPath}.base64` === targetPath && 'base64' in rec) {
      rec.base64 = value;
      if ('mimeType' in rec) rec.mimeType = mediaType;
      if ('mediaType' in rec) rec.mediaType = mediaType;
      return true;
    }

    if (rec.type === 'image' && typeof rec.source === 'object' && rec.source !== null) {
      const source = rec.source as Record<string, unknown>;
      if (`${currentPath}.source.data` === targetPath) {
        source.data = value;
        source.media_type = mediaType;
        return true;
      }
    }

    for (const [key, val] of Object.entries(rec)) {
      if (setBase64AtPath(val, targetPath, `${currentPath}.${key}`, value, mediaType)) return true;
    }
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (setBase64AtPath(obj[i], targetPath, `${currentPath}[${i}]`, value, mediaType)) return true;
    }
  }

  return false;
}

export interface GeminiParsedConversation {
  messages: ChatMessage[];
  timeline: TimelineEvent[];
}

export async function parseConversation(filePath: string): Promise<GeminiParsedConversation> {
  const chatMessages: ChatMessage[] = [];
  const timeline: TimelineEvent[] = [];

  try {
    const raw = await readFile(filePath, 'utf-8');
    const data: GeminiSessionJson = JSON.parse(raw);
    const messages = data.messages || [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const text = extractText(msg.content).trim();

      // Map Gemini types to roles
      let role: 'user' | 'assistant' | 'system';
      if (msg.type === 'user') {
        role = 'user';
      } else if (msg.type === 'gemini') {
        role = 'assistant';
      } else {
        role = 'system'; // info messages
      }

      // Check for images
      const blobs: Array<{ path: string; size: number; mediaType: string }> = [];
      findInlineImages(msg.content, '', blobs);
      const hasImage = blobs.length > 0;
      const imageId = hasImage ? `msg-${i}-${blobs[0].path}` : undefined;

      if (text || hasImage) {
        chatMessages.push({
          id: msg.id || `msg-${i}`,
          role,
          timestamp: msg.timestamp,
          text: text.slice(0, 2000),
          hasImage,
          imageId,
        });
      }

      // Timeline
      if (role === 'user' && text) {
        const userText = text.split('\n')[0].slice(0, 120);
        timeline.push({
          id: msg.id || `msg-${i}`,
          type: 'user',
          timestamp: msg.timestamp,
          summary: userText,
          detail: text.length > 120 ? text.slice(0, 1000) : undefined,
        });
        if (hasImage) {
          timeline.push({
            id: `${msg.id || `msg-${i}`}-img`,
            type: 'image',
            timestamp: msg.timestamp,
            summary: 'Screenshot shared',
            imageId,
          });
        }
      } else if (role === 'assistant' && text) {
        const summary = text.split('\n')[0].slice(0, 120);
        timeline.push({
          id: msg.id || `msg-${i}`,
          type: 'assistant',
          timestamp: msg.timestamp,
          summary,
          detail: text.length > 120 ? text.slice(0, 1000) : undefined,
        });
      }
    }
  } catch {
    // return empty on error
  }

  return { messages: chatMessages, timeline };
}

// ── Secret scanning + redact + export ─────────────────────────────────────

interface MutableGeminiMessage {
  type?: string;
  timestamp?: string;
  content?: unknown;
}

interface MutableGeminiSession {
  messages?: MutableGeminiMessage[];
  [k: string]: unknown;
}

function scanContentInPlace(
  content: unknown,
  unitNumber: number,
  seen: Set<string>,
  timestamp: string | undefined,
  findings: SecretFinding[],
): void {
  if (content === null || content === undefined) return;
  if (typeof content === 'string') {
    findings.push(...scanText(content, unitNumber, seen, timestamp));
    return;
  }
  if (Array.isArray(content)) {
    content.forEach(c => scanContentInPlace(c, unitNumber, seen, timestamp, findings));
    return;
  }
  if (typeof content === 'object') {
    const rec = content as Record<string, unknown>;
    if (typeof rec.text === 'string') {
      findings.push(...scanText(rec.text, unitNumber, seen, timestamp));
    }
    if (Array.isArray(rec.parts)) {
      rec.parts.forEach(p => scanContentInPlace(p, unitNumber, seen, timestamp, findings));
    }
  }
}

export async function scanGeminiSecrets(filePath: string): Promise<SecretFinding[]> {
  const findings: SecretFinding[] = [];
  const seen = new Set<string>();
  try {
    const raw = await readFile(filePath, 'utf-8');
    const session = JSON.parse(raw) as MutableGeminiSession;
    const messages = session.messages ?? [];
    messages.forEach((m, i) => {
      scanContentInPlace(m.content, i + 1, seen, m.timestamp, findings);
    });
  } catch { /* parse error */ }
  return sortFindings(findings);
}

function redactInContent(
  content: unknown,
  filter: RedactFilter | null,
): { content: unknown; replaced: number } {
  if (content === null || content === undefined) return { content, replaced: 0 };
  if (typeof content === 'string') {
    const r = redactText(content, filter);
    return { content: r.text, replaced: r.replaced };
  }
  if (Array.isArray(content)) {
    let replaced = 0;
    const out = content.map(c => {
      const r = redactInContent(c, filter);
      replaced += r.replaced;
      return r.content;
    });
    return { content: out, replaced };
  }
  if (typeof content === 'object') {
    const rec = { ...content as Record<string, unknown> };
    let replaced = 0;
    if (typeof rec.text === 'string') {
      const r = redactText(rec.text, filter);
      rec.text = r.text;
      replaced += r.replaced;
    }
    if (Array.isArray(rec.parts)) {
      const out: unknown[] = [];
      for (const p of rec.parts) {
        const r = redactInContent(p, filter);
        out.push(r.content);
        replaced += r.replaced;
      }
      rec.parts = out;
    }
    return { content: rec, replaced };
  }
  return { content, replaced: 0 };
}

export async function redactGeminiSecrets(
  filePath: string,
  filter: RedactFilter | null,
): Promise<{ replaced: number }> {
  const raw = await readFile(filePath, 'utf-8');
  const session = JSON.parse(raw) as MutableGeminiSession;
  const messages = session.messages ?? [];
  let replaced = 0;
  messages.forEach((m, i) => {
    if (filter?.lineNumber != null && (i + 1) !== filter.lineNumber) return;
    const r = redactInContent(m.content, filter);
    m.content = r.content;
    replaced += r.replaced;
  });
  if (replaced > 0) {
    await writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }
  return { replaced };
}

export async function exportGeminiMarkdown(filePath: string): Promise<string> {
  const out: string[] = [];
  try {
    const raw = await readFile(filePath, 'utf-8');
    const session = JSON.parse(raw) as MutableGeminiSession;
    out.push(`# Gemini session ${session.sessionId ?? basename(filePath)}`, '');
    for (const m of session.messages ?? []) {
      const role = m.type === 'gemini' ? '## Gemini' : m.type === 'user' ? '## User' : `## ${m.type ?? 'message'}`;
      out.push(role, '');
      out.push(extractText(m.content), '');
    }
  } catch { /* fall through */ }
  return out.join('\n');
}
