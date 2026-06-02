import { Adapter, Session, SessionDetail, ImageData } from '../types.js';
import type { CopilotParsedConversation } from './parser.js';
import {
  parseSessionFile,
  parseSessionDetail,
  getImageData as getImageDataFromFile,
  stripImagesFromSession,
  restoreImageInSession,
  parseConversation,
} from './parser.js';
import { readdir, access, copyFile, readFile, writeFile, stat as fsStat, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

import { vscodeWorkspaceStorage } from '../paths.js';
import { BACKUP_DIR } from '../constants.js';

const VSCODE_STORAGE_DIR = vscodeWorkspaceStorage();

async function createBackup(filePath: string): Promise<string> {
  await mkdir(BACKUP_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `copilot_${filePath.split('/').pop()}_${timestamp}`;
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

/**
 * Try to derive a workspace name from the workspace hash directory.
 * VS Code stores a workspace.json in each hash dir with the workspace folder URI.
 */
async function getWorkspaceName(hashDir: string): Promise<string> {
  try {
    const wsFile = join(hashDir, 'workspace.json');
    const raw = await readFile(wsFile, 'utf-8');
    const data = JSON.parse(raw);
    // workspace.json typically has { folder: "file:///path/to/project" }
    const folder = data.folder || data.workspace || '';
    if (typeof folder === 'string' && folder.length > 0) {
      // Extract the last path component from the URI
      const decoded = decodeURIComponent(folder);
      const parts = decoded.replace(/\/$/, '').split('/');
      return parts[parts.length - 1] || 'VS Code';
    }
  } catch {
    // workspace.json may not exist or be unreadable
  }
  return 'VS Code';
}

export class CopilotAdapter implements Adapter {
  name = 'GitHub Copilot';

  clearCache(): void { sessionCache.clear(); sessionFileMap.clear(); }


  async detect(): Promise<boolean> {
    try {
      await access(VSCODE_STORAGE_DIR);
      // Check if any chatSessions directories exist
      const hashDirs = await readdir(VSCODE_STORAGE_DIR, { withFileTypes: true });
      for (const dir of hashDirs) {
        if (!dir.isDirectory()) continue;
        try {
          await access(join(VSCODE_STORAGE_DIR, dir.name, 'chatSessions'));
          return true;
        } catch {
          continue;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  async listSessions(): Promise<Session[]> {
    try {
      let hashDirs: string[];
      try {
        const entries = await readdir(VSCODE_STORAGE_DIR, { withFileTypes: true });
        hashDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
      } catch {
        return [];
      }

      const filesToParse: Array<{ filePath: string; hashDir: string }> = [];

      for (const hashName of hashDirs) {
        const chatSessionsDir = join(VSCODE_STORAGE_DIR, hashName, 'chatSessions');
        try {
          const files = await readdir(chatSessionsDir, { withFileTypes: true });
          for (const file of files) {
            if (!file.name.endsWith('.json')) continue;
            filesToParse.push({
              filePath: join(chatSessionsDir, file.name),
              hashDir: join(VSCODE_STORAGE_DIR, hashName),
            });
          }
        } catch {
          // chatSessions dir may not exist for this workspace
        }
      }

      // Check mtime, only re-parse changed files
      const sessions: Session[] = [];
      const needsParsing: Array<{ filePath: string; hashDir: string; mtimeMs: number }> = [];

      for (const { filePath, hashDir } of filesToParse) {
        try {
          const stats = await fsStat(filePath);
          const cached = sessionCache.get(filePath);
          if (cached && cached.mtimeMs === stats.mtimeMs) {
            sessions.push(cached.session);
          } else {
            needsParsing.push({ filePath, hashDir, mtimeMs: stats.mtimeMs });
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
          batch.map(async ({ filePath, hashDir, mtimeMs }) => {
            const session = await parseSessionFile(filePath);
            if (session) {
              // Resolve workspace name from the hash directory
              session.project = await getWorkspaceName(hashDir);
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
        if (key.includes('chatSessions') && !currentPaths.has(key)) {
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

    // Fall back to scanning all workspace hash dirs
    let hashDirs: string[];
    try {
      const entries = await readdir(VSCODE_STORAGE_DIR, { withFileTypes: true });
      hashDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {
      throw new Error(`Session ${sessionId} not found`);
    }

    for (const hashName of hashDirs) {
      const chatSessionsDir = join(VSCODE_STORAGE_DIR, hashName, 'chatSessions');
      try {
        const files = await readdir(chatSessionsDir);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          const filePath = join(chatSessionsDir, file);
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

    // Also try direct filename match (sessionId might be the filename)
    for (const hashName of hashDirs) {
      const filePath = join(VSCODE_STORAGE_DIR, hashName, 'chatSessions', `${sessionId}.json`);
      try {
        await access(filePath);
        sessionFileMap.set(sessionId, filePath);
        return filePath;
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

    // Resolve workspace name
    const hashDir = dirname(dirname(filePath)); // up from chatSessions/<file> to <hash>
    detail.project = await getWorkspaceName(hashDir);

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

  async getConversation(sessionId: string): Promise<CopilotParsedConversation> {
    const filePath = await this.findSessionFile(sessionId);
    return parseConversation(filePath);
  }
}
