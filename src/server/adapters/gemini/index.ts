import { Adapter, Session, SessionDetail, ImageData } from '../types.js';
import type { GeminiParsedConversation } from './parser.js';
import {
  parseSessionFile,
  parseSessionDetail,
  getImageData as getImageDataFromFile,
  stripImagesFromSession,
  restoreImageInSession,
  parseConversation,
} from './parser.js';
import { readdir, access, copyFile, readFile, writeFile, stat as fsStat, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { BACKUP_DIR } from '../constants.js';

const GEMINI_DIR = join(homedir(), '.gemini', 'tmp');

async function createBackup(filePath: string): Promise<string> {
  await mkdir(BACKUP_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `gemini_${filePath.split('/').pop()}_${timestamp}`;
  const backupPath = join(BACKUP_DIR, fileName);

  await copyFile(filePath, backupPath);

  // Verify backup integrity
  const [origStats, backupStats] = await Promise.all([fsStat(filePath), fsStat(backupPath)]);
  if (origStats.size !== backupStats.size) {
    throw new Error(`Backup verification failed: size mismatch (${origStats.size} vs ${backupStats.size})`);
  }

  return backupPath;
}

// Server-side cache: only re-parse files whose mtime changed
const sessionCache = new Map<string, { mtimeMs: number; session: Session }>();

// Map sessionId -> filePath for quick lookup
const sessionFileMap = new Map<string, string>();

export class GeminiAdapter implements Adapter {
  name = 'Gemini CLI';

  clearCache(): void { sessionCache.clear(); }


  async detect(): Promise<boolean> {
    try {
      await access(join(homedir(), '.gemini'));
      return true;
    } catch {
      return false;
    }
  }

  async listSessions(): Promise<Session[]> {
    try {
      // Scan ~/.gemini/tmp/*/chats/session-*.json
      let projectDirs: string[];
      try {
        const entries = await readdir(GEMINI_DIR, { withFileTypes: true });
        projectDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
      } catch {
        return [];
      }

      const filesToParse: Array<{ filePath: string; project: string }> = [];

      for (const dirName of projectDirs) {
        const chatsDir = join(GEMINI_DIR, dirName, 'chats');
        try {
          const files = await readdir(chatsDir, { withFileTypes: true });
          for (const file of files) {
            if (!file.name.startsWith('session-') || !file.name.endsWith('.json')) continue;
            filesToParse.push({
              filePath: join(chatsDir, file.name),
              project: dirName,
            });
          }
        } catch {
          // chats dir may not exist for this project
        }
      }

      // Check mtime, only re-parse changed files
      const sessions: Session[] = [];
      const needsParsing: Array<{ filePath: string; project: string; mtimeMs: number }> = [];

      for (const { filePath, project } of filesToParse) {
        try {
          const stats = await fsStat(filePath);
          const cached = sessionCache.get(filePath);
          if (cached && cached.mtimeMs === stats.mtimeMs) {
            sessions.push(cached.session);
          } else {
            needsParsing.push({ filePath, project, mtimeMs: stats.mtimeMs });
          }
        } catch {
          // file disappeared
        }
      }

      // Parse in parallel batches
      const batchSize = 10;
      for (let i = 0; i < needsParsing.length; i += batchSize) {
        const batch = needsParsing.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async ({ filePath, project, mtimeMs }) => {
            const session = await parseSessionFile(filePath);
            if (session) {
              session.project = project;
              sessionCache.set(filePath, { mtimeMs, session });
              sessionFileMap.set(session.id, filePath);
            }
            return session;
          })
        );
        for (const s of results) {
          if (s) sessions.push(s);
        }
      }

      // Also populate sessionFileMap for cached sessions
      for (const { filePath } of filesToParse) {
        const cached = sessionCache.get(filePath);
        if (cached) {
          sessionFileMap.set(cached.session.id, filePath);
        }
      }

      // Clean stale cache entries
      const currentPaths = new Set(filesToParse.map(f => f.filePath));
      for (const key of sessionCache.keys()) {
        // Only clean gemini entries (don't touch other adapter caches)
        if (key.includes('.gemini') && !currentPaths.has(key)) {
          sessionCache.delete(key);
        }
      }

      return sessions;
    } catch {
      return [];
    }
  }

  private async findSessionFile(sessionId: string): Promise<string> {
    // Check the quick-lookup map first
    const cached = sessionFileMap.get(sessionId);
    if (cached) {
      try {
        await access(cached);
        return cached;
      } catch {
        sessionFileMap.delete(sessionId);
      }
    }

    // Fall back to scanning
    let projectDirs: string[];
    try {
      const entries = await readdir(GEMINI_DIR, { withFileTypes: true });
      projectDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {
      throw new Error(`Session ${sessionId} not found`);
    }

    for (const dirName of projectDirs) {
      const chatsDir = join(GEMINI_DIR, dirName, 'chats');
      try {
        const files = await readdir(chatsDir);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          const filePath = join(chatsDir, file);
          try {
            const raw = await readFile(filePath, 'utf-8');
            const data = JSON.parse(raw);
            if (data.sessionId === sessionId) {
              sessionFileMap.set(sessionId, filePath);
              return filePath;
            }
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }

    throw new Error(`Session ${sessionId} not found`);
  }

  async getSessionDetail(sessionId: string): Promise<SessionDetail> {
    const filePath = await this.findSessionFile(sessionId);
    const detail = await parseSessionDetail(filePath);
    if (!detail) throw new Error(`Could not parse session ${sessionId}`);
    return detail;
  }

  async getImageData(sessionId: string, imageId: string): Promise<ImageData> {
    const filePath = await this.findSessionFile(sessionId);
    const data = await getImageDataFromFile(filePath, imageId);
    if (!data) throw new Error(`Image ${imageId} not found in session ${sessionId}`);
    return data;
  }

  async stripImages(sessionId: string, imageIds: string[]): Promise<{ backupPath: string; bytesReclaimed: number }> {
    const filePath = await this.findSessionFile(sessionId);
    const backupPath = await createBackup(filePath);

    const content = await readFile(filePath, 'utf-8');
    const originalSize = Buffer.byteLength(content, 'utf-8');

    const idSet = new Set(imageIds);
    const { result, stripped } = stripImagesFromSession(content, idSet);

    if (stripped === 0) {
      return { backupPath, bytesReclaimed: 0 };
    }

    await writeFile(filePath, result, 'utf-8');
    const newSize = Buffer.byteLength(result, 'utf-8');

    return { backupPath, bytesReclaimed: originalSize - newSize };
  }

  async stripAllImages(sessionId: string): Promise<{ backupPath: string; bytesReclaimed: number }> {
    const filePath = await this.findSessionFile(sessionId);
    const backupPath = await createBackup(filePath);

    const content = await readFile(filePath, 'utf-8');
    const originalSize = Buffer.byteLength(content, 'utf-8');

    const { result, stripped } = stripImagesFromSession(content, null);

    if (stripped === 0) {
      return { backupPath, bytesReclaimed: 0 };
    }

    await writeFile(filePath, result, 'utf-8');
    const newSize = Buffer.byteLength(result, 'utf-8');

    return { backupPath, bytesReclaimed: originalSize - newSize };
  }

  async restoreImage(sessionId: string, imageId: string, base64: string, mediaType: string): Promise<void> {
    const filePath = await this.findSessionFile(sessionId);
    const content = await readFile(filePath, 'utf-8');
    const result = restoreImageInSession(content, imageId, base64, mediaType);
    await writeFile(filePath, result, 'utf-8');
  }

  async getConversation(sessionId: string): Promise<GeminiParsedConversation> {
    const filePath = await this.findSessionFile(sessionId);
    return parseConversation(filePath);
  }
}
