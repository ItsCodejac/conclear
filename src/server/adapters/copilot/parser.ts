import { Session, SessionDetail, SessionImage, ImageData, ChatMessage, TimelineEvent } from '../types.js';
import { readFile, stat } from 'fs/promises';
import { basename } from 'path';

/**
 * GitHub Copilot Chat session JSON format (VS Code):
 * {
 *   version: number,
 *   requesterUsername: string,
 *   responderUsername: string,
 *   sessionId: string,
 *   creationDate: string (ISO or epoch),
 *   mode: 'agent' | 'chat',
 *   selectedModel: string,
 *   requests: [
 *     {
 *       message: { text: string, ... },
 *       response: [{ value: string, ... }] | string,
 *       result?: { metadata?: { ... } },
 *       timestamp?: number,
 *       variableData?: { variables?: [...] },
 *       ...
 *     }
 *   ]
 * }
 */

interface CopilotTurnMessage {
  text?: string;
  parts?: Array<{ type?: string; value?: string; data?: string; mimeType?: string }>;
}

interface CopilotResponsePart {
  value?: string;
  type?: string;
}

interface CopilotRequest {
  message?: CopilotTurnMessage;
  response?: CopilotResponsePart[] | string;
  result?: Record<string, unknown>;
  timestamp?: number;
  variableData?: { variables?: Array<{ name?: string; value?: string }> };
}

interface CopilotSessionJson {
  version?: number;
  requesterUsername?: string;
  responderUsername?: string;
  sessionId?: string;
  creationDate?: string | number;
  mode?: string;
  selectedModel?: string;
  requests?: CopilotRequest[];
}

/** Extract text from a Copilot message field */
function extractMessageText(msg: CopilotTurnMessage | undefined): string {
  if (!msg) return '';
  if (typeof msg.text === 'string') return msg.text;
  if (Array.isArray(msg.parts)) {
    return msg.parts
      .filter(p => !p.type || p.type === 'text')
      .map(p => p.value || '')
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/** Extract text from Copilot response field */
function extractResponseText(response: CopilotResponsePart[] | string | undefined): string {
  if (!response) return '';
  if (typeof response === 'string') return response;
  if (Array.isArray(response)) {
    return response
      .map(part => part.value || '')
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/** Find inline base64 image data in Copilot message parts */
function findInlineImages(
  request: CopilotRequest,
  requestIndex: number,
  results: Array<{ id: string; size: number; mediaType: string; location: 'message' | 'response' }>
): void {
  // Check message parts for images
  if (request.message?.parts) {
    for (let j = 0; j < request.message.parts.length; j++) {
      const part = request.message.parts[j];
      if (part.data && part.data.length > 200) {
        results.push({
          id: `req-${requestIndex}-msg-part-${j}`,
          size: Math.ceil(part.data.length * 0.75),
          mediaType: part.mimeType || 'image/png',
          location: 'message',
        });
      }
    }
  }

  // Check response for inline images (less common but possible)
  if (Array.isArray(request.response)) {
    for (let j = 0; j < request.response.length; j++) {
      const part = request.response[j];
      if (part.type === 'image' && part.value && part.value.length > 200) {
        results.push({
          id: `req-${requestIndex}-resp-part-${j}`,
          size: Math.ceil(part.value.length * 0.75),
          mediaType: 'image/png',
          location: 'response',
        });
      }
    }
  }

  // Also check variableData for attached images
  if (request.variableData?.variables) {
    for (let j = 0; j < request.variableData.variables.length; j++) {
      const v = request.variableData.variables[j];
      if (v.value && v.value.length > 200 && isLikelyBase64Image(v.value)) {
        results.push({
          id: `req-${requestIndex}-var-${j}`,
          size: Math.ceil(v.value.length * 0.75),
          mediaType: 'image/png',
          location: 'message',
        });
      }
    }
  }
}

/** Quick heuristic for base64 image data */
function isLikelyBase64Image(value: string): boolean {
  // Check for common image base64 prefixes
  return (
    value.startsWith('iVBOR') || // PNG
    value.startsWith('/9j/')  || // JPEG
    value.startsWith('R0lGOD')   // GIF
  );
}

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Parse a Copilot session file for the session list */
export async function parseSessionFile(filePath: string): Promise<Session | null> {
  try {
    const stats = await stat(filePath);
    const raw = await readFile(filePath, 'utf-8');
    const data: CopilotSessionJson = JSON.parse(raw);

    if (!data.requests || !Array.isArray(data.requests)) return null;

    const requests = data.requests;
    const messageCount = requests.length * 2; // Each request has a user message + response

    // Count images
    let imageCount = 0;
    let imageSizeBytes = 0;
    for (let i = 0; i < requests.length; i++) {
      const blobs: Array<{ id: string; size: number; mediaType: string; location: string }> = [];
      findInlineImages(requests[i], i, blobs);
      imageCount += blobs.length;
      imageSizeBytes += blobs.reduce((sum, b) => sum + b.size, 0);
    }

    // Preview: first user message text
    let preview: string | null = null;
    for (const req of requests) {
      const text = extractMessageText(req.message).trim().replace(/\s+/g, ' ');
      if (text.length > 0) {
        preview = text.length > 60 ? text.slice(0, 57) + '...' : text;
        break;
      }
    }

    // Timestamps
    let createdAt = stats.birthtimeMs;
    if (data.creationDate) {
      if (typeof data.creationDate === 'number') {
        createdAt = data.creationDate;
      } else {
        const parsed = new Date(data.creationDate).getTime();
        if (!isNaN(parsed)) createdAt = parsed;
      }
    }

    // Last active: latest request timestamp or file mtime
    let lastActiveAt = stats.mtimeMs;
    for (const req of requests) {
      if (req.timestamp && req.timestamp > lastActiveAt) {
        lastActiveAt = req.timestamp;
      }
    }

    // Session ID: use file's sessionId field or derive from filename
    const sessionId = data.sessionId || basename(filePath, '.json');

    // Build a name from mode + model if available
    let name: string | null = null;
    if (data.mode || data.selectedModel) {
      const parts: string[] = [];
      if (data.mode) parts.push(data.mode);
      if (data.selectedModel) parts.push(data.selectedModel);
      name = parts.join(' \u2014 ');
    }

    return {
      id: sessionId,
      name,
      preview,
      project: 'VS Code', // Will be overridden by workspace detection in index.ts
      tool: 'copilot',
      createdAt,
      lastActiveAt,
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

/** Parse a Copilot session file for detailed view */
export async function parseSessionDetail(filePath: string): Promise<SessionDetail | null> {
  try {
    const stats = await stat(filePath);
    const raw = await readFile(filePath, 'utf-8');
    const data: CopilotSessionJson = JSON.parse(raw);

    if (!data.requests || !Array.isArray(data.requests)) return null;

    const requests = data.requests;
    const messageCount = requests.length * 2;

    const images: SessionImage[] = [];
    let toolResultSizeBytes = 0;
    let lastUserText = '';

    for (let i = 0; i < requests.length; i++) {
      const req = requests[i];
      const userText = extractMessageText(req.message).trim().replace(/\s+/g, ' ');
      if (userText) lastUserText = userText;

      // Find images
      const blobs: Array<{ id: string; size: number; mediaType: string; location: string }> = [];
      findInlineImages(req, i, blobs);

      for (const blob of blobs) {
        let context = '';
        if (req.timestamp) {
          const d = new Date(req.timestamp);
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
          context = `Image in request ${i + 1}`;
        } else {
          context = `Screenshot at ${context}`;
        }

        images.push({
          id: blob.id,
          lineNumber: i,
          sizeBytes: blob.size,
          mediaType: blob.mediaType,
          context,
          timestamp: req.timestamp ? new Date(req.timestamp).toISOString() : undefined,
        });
      }

      // Tool result size: count response text that's large
      const responseText = extractResponseText(req.response);
      if (responseText.length > 500) {
        toolResultSizeBytes += Buffer.byteLength(responseText, 'utf-8');
      }
    }

    const imageSizeBytes = images.reduce((sum, img) => sum + img.sizeBytes, 0);

    // Preview
    let preview: string | null = null;
    for (const req of requests) {
      const text = extractMessageText(req.message).trim().replace(/\s+/g, ' ');
      if (text.length > 0) {
        preview = text.length > 60 ? text.slice(0, 57) + '...' : text;
        break;
      }
    }

    // Timestamps
    let createdAt = stats.birthtimeMs;
    if (data.creationDate) {
      if (typeof data.creationDate === 'number') {
        createdAt = data.creationDate;
      } else {
        const parsed = new Date(data.creationDate).getTime();
        if (!isNaN(parsed)) createdAt = parsed;
      }
    }

    let lastActiveAt = stats.mtimeMs;
    for (const req of requests) {
      if (req.timestamp && req.timestamp > lastActiveAt) {
        lastActiveAt = req.timestamp;
      }
    }

    const sessionId = data.sessionId || basename(filePath, '.json');

    let name: string | null = null;
    if (data.mode || data.selectedModel) {
      const parts: string[] = [];
      if (data.mode) parts.push(data.mode);
      if (data.selectedModel) parts.push(data.selectedModel);
      name = parts.join(' \u2014 ');
    }

    return {
      id: sessionId,
      name,
      preview,
      project: 'VS Code',
      tool: 'copilot',
      createdAt,
      lastActiveAt,
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

/** Get base64 image data for a specific image in a Copilot session */
export async function getImageData(filePath: string, imageId: string): Promise<ImageData | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const data: CopilotSessionJson = JSON.parse(raw);
    const requests = data.requests || [];

    // Parse imageId format: "req-{idx}-msg-part-{j}" or "req-{idx}-resp-part-{j}" or "req-{idx}-var-{j}"
    const msgMatch = imageId.match(/^req-(\d+)-msg-part-(\d+)$/);
    if (msgMatch) {
      const reqIdx = parseInt(msgMatch[1], 10);
      const partIdx = parseInt(msgMatch[2], 10);
      if (reqIdx < requests.length) {
        const parts = requests[reqIdx].message?.parts;
        if (parts && partIdx < parts.length && parts[partIdx].data) {
          return {
            base64: parts[partIdx].data!,
            mediaType: parts[partIdx].mimeType || 'image/png',
          };
        }
      }
    }

    const respMatch = imageId.match(/^req-(\d+)-resp-part-(\d+)$/);
    if (respMatch) {
      const reqIdx = parseInt(respMatch[1], 10);
      const partIdx = parseInt(respMatch[2], 10);
      if (reqIdx < requests.length) {
        const response = requests[reqIdx].response;
        if (Array.isArray(response) && partIdx < response.length && response[partIdx].value) {
          return {
            base64: response[partIdx].value!,
            mediaType: 'image/png',
          };
        }
      }
    }

    const varMatch = imageId.match(/^req-(\d+)-var-(\d+)$/);
    if (varMatch) {
      const reqIdx = parseInt(varMatch[1], 10);
      const varIdx = parseInt(varMatch[2], 10);
      if (reqIdx < requests.length) {
        const vars = requests[reqIdx].variableData?.variables;
        if (vars && varIdx < vars.length && vars[varIdx].value) {
          return {
            base64: vars[varIdx].value!,
            mediaType: 'image/png',
          };
        }
      }
    }
  } catch {
    // parse error
  }
  return null;
}

/** Replace base64 blobs with tiny placeholder in a request */
function replaceBase64InRequest(request: CopilotRequest, imageIds: Set<string> | null, requestIndex: number): number {
  let replaced = 0;

  // Message parts
  if (request.message?.parts) {
    for (let j = 0; j < request.message.parts.length; j++) {
      const part = request.message.parts[j];
      if (part.data && part.data.length > 200) {
        const id = `req-${requestIndex}-msg-part-${j}`;
        if (imageIds === null || imageIds.has(id)) {
          part.data = TINY_PNG;
          part.mimeType = 'image/png';
          replaced++;
        }
      }
    }
  }

  // Response parts
  if (Array.isArray(request.response)) {
    for (let j = 0; j < request.response.length; j++) {
      const part = request.response[j];
      if (part.type === 'image' && part.value && part.value.length > 200) {
        const id = `req-${requestIndex}-resp-part-${j}`;
        if (imageIds === null || imageIds.has(id)) {
          part.value = TINY_PNG;
          replaced++;
        }
      }
    }
  }

  // Variable data
  if (request.variableData?.variables) {
    for (let j = 0; j < request.variableData.variables.length; j++) {
      const v = request.variableData.variables[j];
      if (v.value && v.value.length > 200 && isLikelyBase64Image(v.value)) {
        const id = `req-${requestIndex}-var-${j}`;
        if (imageIds === null || imageIds.has(id)) {
          v.value = TINY_PNG;
          replaced++;
        }
      }
    }
  }

  return replaced;
}

/** Strip images from session content */
export function stripImagesFromSession(raw: string, imageIds: Set<string> | null): { result: string; stripped: number } {
  try {
    const data: CopilotSessionJson = JSON.parse(raw);
    const requests = data.requests || [];
    let stripped = 0;

    for (let i = 0; i < requests.length; i++) {
      stripped += replaceBase64InRequest(requests[i], imageIds, i);
    }

    return { result: JSON.stringify(data, null, 2), stripped };
  } catch {
    return { result: raw, stripped: 0 };
  }
}

/** Restore a specific image in a session */
export function restoreImageInSession(raw: string, imageId: string, base64: string, mediaType: string): string {
  const data: CopilotSessionJson = JSON.parse(raw);
  const requests = data.requests || [];

  const msgMatch = imageId.match(/^req-(\d+)-msg-part-(\d+)$/);
  if (msgMatch) {
    const reqIdx = parseInt(msgMatch[1], 10);
    const partIdx = parseInt(msgMatch[2], 10);
    if (reqIdx < requests.length && requests[reqIdx].message?.parts) {
      const parts = requests[reqIdx].message!.parts!;
      if (partIdx < parts.length) {
        parts[partIdx].data = base64;
        parts[partIdx].mimeType = mediaType;
        return JSON.stringify(data, null, 2);
      }
    }
  }

  const respMatch = imageId.match(/^req-(\d+)-resp-part-(\d+)$/);
  if (respMatch) {
    const reqIdx = parseInt(respMatch[1], 10);
    const partIdx = parseInt(respMatch[2], 10);
    if (reqIdx < requests.length && Array.isArray(requests[reqIdx].response)) {
      const resp = requests[reqIdx].response as CopilotResponsePart[];
      if (partIdx < resp.length) {
        resp[partIdx].value = base64;
        return JSON.stringify(data, null, 2);
      }
    }
  }

  const varMatch = imageId.match(/^req-(\d+)-var-(\d+)$/);
  if (varMatch) {
    const reqIdx = parseInt(varMatch[1], 10);
    const varIdx = parseInt(varMatch[2], 10);
    if (reqIdx < requests.length && requests[reqIdx].variableData?.variables) {
      const vars = requests[reqIdx].variableData!.variables!;
      if (varIdx < vars.length) {
        vars[varIdx].value = base64;
        return JSON.stringify(data, null, 2);
      }
    }
  }

  throw new Error('Could not find image path in session');
}

export interface CopilotParsedConversation {
  messages: ChatMessage[];
  timeline: TimelineEvent[];
}

/** Parse a Copilot session into conversation messages and timeline */
export async function parseConversation(filePath: string): Promise<CopilotParsedConversation> {
  const chatMessages: ChatMessage[] = [];
  const timeline: TimelineEvent[] = [];

  try {
    const raw = await readFile(filePath, 'utf-8');
    const data: CopilotSessionJson = JSON.parse(raw);
    const requests = data.requests || [];

    for (let i = 0; i < requests.length; i++) {
      const req = requests[i];
      const userText = extractMessageText(req.message).trim();
      const respText = extractResponseText(req.response).trim();

      const timestamp = req.timestamp ? new Date(req.timestamp).toISOString() : undefined;

      // Check for images in this request
      const blobs: Array<{ id: string; size: number; mediaType: string; location: string }> = [];
      findInlineImages(req, i, blobs);
      const hasUserImage = blobs.some(b => b.location === 'message');
      const userImageId = hasUserImage ? blobs.find(b => b.location === 'message')?.id : undefined;

      // User message
      if (userText || hasUserImage) {
        chatMessages.push({
          id: `req-${i}-user`,
          role: 'user',
          timestamp,
          text: userText.slice(0, 2000),
          hasImage: hasUserImage,
          imageId: userImageId,
        });

        // Timeline: user turn
        const userSummary = userText.split('\n')[0].slice(0, 120);
        timeline.push({
          id: `req-${i}-user`,
          type: 'user',
          timestamp,
          summary: userSummary || '(image)',
          detail: userText.length > 120 ? userText.slice(0, 1000) : undefined,
        });

        if (hasUserImage) {
          timeline.push({
            id: `req-${i}-user-img`,
            type: 'image',
            timestamp,
            summary: 'Screenshot shared',
            imageId: userImageId,
          });
        }
      }

      // Assistant response
      if (respText) {
        const hasRespImage = blobs.some(b => b.location === 'response');
        const respImageId = hasRespImage ? blobs.find(b => b.location === 'response')?.id : undefined;

        chatMessages.push({
          id: `req-${i}-assistant`,
          role: 'assistant',
          timestamp,
          text: respText.slice(0, 2000),
          hasImage: hasRespImage,
          imageId: respImageId,
        });

        // Timeline: assistant turn
        const respSummary = respText.split('\n')[0].slice(0, 120);
        timeline.push({
          id: `req-${i}-assistant`,
          type: 'assistant',
          timestamp,
          summary: respSummary,
          detail: respText.length > 120 ? respText.slice(0, 1000) : undefined,
        });
      }
    }
  } catch {
    // return empty on error
  }

  return { messages: chatMessages, timeline };
}
