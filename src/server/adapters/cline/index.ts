import { Adapter, Session, SessionDetail, ImageData, FileHistory } from '../types.js';
import type { ClineParsedConversation } from './parser.js';
import {
  parseTaskSession,
  parseTaskDetail,
  getImageData as getImageDataFromFile,
  stripImagesFromContent,
  resizeImagesInContent,
  restoreImageInContent,
  parseConversation,
  parseFileHistory,
  getFileContent as getFileContentFromFile,
} from './parser.js';
import { readdir, access, copyFile, readFile, writeFile, stat as fsStat, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { vscodeGlobalStorage } from '../paths.js';

/** Both Cline and Roo Code use the same directory structure under VS Code globalStorage */
const VSCODE_GLOBAL_STORAGE = vscodeGlobalStorage();

const SOURCE_DIRS: Array<{ path: string; label: string }> = [
  { path: join(VSCODE_GLOBAL_STORAGE, 'saoudrizwan.claude-dev', 'tasks'), label: 'Cline' },
  { path: join(VSCODE_GLOBAL_STORAGE, 'rooveterinaryinc.roo-cline', 'tasks'), label: 'Roo Code' },
];

const BACKUP_DIR = join(homedir(), '.conclear', 'backups');

async function createBackup(filePath: string): Promise<string> {
  await mkdir(BACKUP_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `cline_${filePath.split('/').pop()}_${timestamp}`;
  const backupPath = join(BACKUP_DIR, fileName);

  await copyFile(filePath, backupPath);

  // Verify backup integrity
  const [origStats, backupStats] = await Promise.all([fsStat(filePath), fsStat(backupPath)]);
  if (origStats.size !== backupStats.size) {
    throw new Error(`Backup verification failed: size mismatch (${origStats.size} vs ${backupStats.size})`);
  }

  return backupPath;
}

// Server-side cache: only re-parse tasks whose mtime changed
const sessionCache = new Map<string, { mtimeMs: number; session: Session }>();

// Map sessionId -> { apiPath, taskDir, sourceLabel } for quick lookup
const sessionFileMap = new Map<string, { apiPath: string; taskDir: string; sourceLabel: string }>();

/**
 * Discover which source directories actually exist on this machine.
 */
async function getAvailableSources(): Promise<Array<{ path: string; label: string }>> {
  const available: Array<{ path: string; label: string }> = [];
  for (const src of SOURCE_DIRS) {
    try {
      await access(src.path);
      available.push(src);
    } catch {
      // not installed
    }
  }
  return available;
}

export class ClineAdapter implements Adapter {
  name = 'Cline / Roo Code';

  async detect(): Promise<boolean> {
    const sources = await getAvailableSources();
    return sources.length > 0;
  }

  async listSessions(): Promise<Session[]> {
    try {
      const sources = await getAvailableSources();
      if (sources.length === 0) return [];

      const filesToParse: Array<{ taskDir: string; taskId: string; apiPath: string; sourceLabel: string }> = [];

      for (const src of sources) {
        try {
          const taskDirs = await readdir(src.path, { withFileTypes: true });
          for (const dir of taskDirs) {
            if (!dir.isDirectory()) continue;
            const taskDir = join(src.path, dir.name);
            const apiPath = join(taskDir, 'api_conversation_history.json');
            try {
              await access(apiPath);
              filesToParse.push({ taskDir, taskId: dir.name, apiPath, sourceLabel: src.label });
            } catch {
              // no api_conversation_history.json in this task
            }
          }
        } catch {
          // can't read source dir
        }
      }

      // Check mtime, only re-parse changed files
      const sessions: Session[] = [];
      const needsParsing: Array<{ taskDir: string; taskId: string; apiPath: string; sourceLabel: string; mtimeMs: number }> = [];

      for (const entry of filesToParse) {
        try {
          const stats = await fsStat(entry.apiPath);
          const cached = sessionCache.get(entry.apiPath);
          if (cached && cached.mtimeMs === stats.mtimeMs) {
            sessions.push(cached.session);
          } else {
            needsParsing.push({ ...entry, mtimeMs: stats.mtimeMs });
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
          batch.map(async ({ taskDir, taskId, apiPath, sourceLabel, mtimeMs }) => {
            const session = await parseTaskSession(taskDir, taskId, sourceLabel);
            if (session) {
              sessionCache.set(apiPath, { mtimeMs, session });
              sessionFileMap.set(taskId, { apiPath, taskDir, sourceLabel });
            }
            return session;
          })
        );
        for (const s of results) {
          if (s) sessions.push(s);
        }
      }

      // Also populate sessionFileMap for cached sessions
      for (const entry of filesToParse) {
        const cached = sessionCache.get(entry.apiPath);
        if (cached) {
          sessionFileMap.set(entry.taskId, { apiPath: entry.apiPath, taskDir: entry.taskDir, sourceLabel: entry.sourceLabel });
        }
      }

      // Clean stale cache entries
      const currentPaths = new Set(filesToParse.map(f => f.apiPath));
      for (const key of sessionCache.keys()) {
        if (key.includes('globalStorage') && !currentPaths.has(key)) {
          sessionCache.delete(key);
        }
      }

      return sessions;
    } catch {
      return [];
    }
  }

  private async findSession(sessionId: string): Promise<{ apiPath: string; taskDir: string; sourceLabel: string }> {
    // Check quick-lookup map first
    const cached = sessionFileMap.get(sessionId);
    if (cached) {
      try {
        await access(cached.apiPath);
        return cached;
      } catch {
        sessionFileMap.delete(sessionId);
      }
    }

    // Fall back to scanning
    const sources = await getAvailableSources();
    for (const src of sources) {
      const taskDir = join(src.path, sessionId);
      const apiPath = join(taskDir, 'api_conversation_history.json');
      try {
        await access(apiPath);
        const entry = { apiPath, taskDir, sourceLabel: src.label };
        sessionFileMap.set(sessionId, entry);
        return entry;
      } catch {
        continue;
      }
    }

    throw new Error(`Session ${sessionId} not found`);
  }

  async getSessionDetail(sessionId: string): Promise<SessionDetail> {
    const { taskDir, sourceLabel } = await this.findSession(sessionId);
    const detail = await parseTaskDetail(taskDir, sessionId, sourceLabel);
    if (!detail) throw new Error(`Could not parse session ${sessionId}`);
    return detail;
  }

  async getImageData(sessionId: string, imageId: string): Promise<ImageData> {
    const { apiPath } = await this.findSession(sessionId);
    const data = await getImageDataFromFile(apiPath, imageId);
    if (!data) throw new Error(`Image ${imageId} not found in session ${sessionId}`);
    return data;
  }

  async stripImages(sessionId: string, imageIds: string[]): Promise<{ backupPath: string; bytesReclaimed: number }> {
    const { apiPath } = await this.findSession(sessionId);
    const backupPath = await createBackup(apiPath);

    const content = await readFile(apiPath, 'utf-8');
    const originalSize = Buffer.byteLength(content, 'utf-8');

    const idSet = new Set(imageIds);
    const { result, stripped } = stripImagesFromContent(content, idSet);

    if (stripped === 0) {
      return { backupPath, bytesReclaimed: 0 };
    }

    await writeFile(apiPath, result, 'utf-8');
    const newSize = Buffer.byteLength(result, 'utf-8');

    return { backupPath, bytesReclaimed: originalSize - newSize };
  }

  async stripAllImages(sessionId: string): Promise<{ backupPath: string; bytesReclaimed: number }> {
    const { apiPath } = await this.findSession(sessionId);
    const backupPath = await createBackup(apiPath);

    const content = await readFile(apiPath, 'utf-8');
    const originalSize = Buffer.byteLength(content, 'utf-8');

    const { result, stripped } = stripImagesFromContent(content, null);

    if (stripped === 0) {
      return { backupPath, bytesReclaimed: 0 };
    }

    await writeFile(apiPath, result, 'utf-8');
    const newSize = Buffer.byteLength(result, 'utf-8');

    return { backupPath, bytesReclaimed: originalSize - newSize };
  }

  async resizeImages(
    sessionId: string,
    imageIds: string[] | null,
    targetBytes: number,
  ): Promise<{ backupPath: string; bytesReclaimed: number }> {
    const { apiPath } = await this.findSession(sessionId);
    const backupPath = await createBackup(apiPath);

    const content = await readFile(apiPath, 'utf-8');
    const originalSize = Buffer.byteLength(content, 'utf-8');

    const idSet = imageIds ? new Set(imageIds) : null;
    const { result } = await resizeImagesInContent(content, idSet, targetBytes);

    await writeFile(apiPath, result, 'utf-8');
    const newSize = Buffer.byteLength(result, 'utf-8');

    return { backupPath, bytesReclaimed: originalSize - newSize };
  }

  async restoreImage(sessionId: string, imageId: string, base64: string, mediaType: string): Promise<void> {
    const { apiPath } = await this.findSession(sessionId);
    const content = await readFile(apiPath, 'utf-8');
    const result = await restoreImageInContent(content, imageId, base64, mediaType);
    await writeFile(apiPath, result, 'utf-8');
  }

  async getConversation(sessionId: string): Promise<ClineParsedConversation> {
    const { apiPath } = await this.findSession(sessionId);
    return parseConversation(apiPath);
  }

  async getFileHistory(sessionId: string): Promise<FileHistory[]> {
    const { apiPath } = await this.findSession(sessionId);
    return parseFileHistory(apiPath);
  }

  async getFileContent(sessionId: string, lineNumber: number): Promise<string | null> {
    const { apiPath } = await this.findSession(sessionId);
    return getFileContentFromFile(apiPath, lineNumber);
  }
}
