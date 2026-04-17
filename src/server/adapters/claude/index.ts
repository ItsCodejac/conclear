import { Adapter, Session, SessionDetail, ImageData } from '../types.js';
import type { ParsedConversation } from './parser.js';
import type { FileHistory } from '../types.js';
import { parseSessionFile, parseSessionDetail, stripImagesFromContent, resizeImagesInContent, getImageData as getImageDataFromFile, restoreImageData, parseConversation, parseFileHistory, getFileContent as getFileContentFromFile, exportSessionMarkdown } from './parser.js';
import { readdir, access, copyFile, readFile, writeFile, stat as fsStat, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';

const CLAUDE_DIR = join(homedir(), '.claude', 'projects');
const CLAUDE_SESSIONS_DIR = join(homedir(), '.claude', 'sessions');
const BACKUP_DIR = join(homedir(), '.conclear', 'backups');

async function createBackup(filePath: string): Promise<string> {
  await mkdir(BACKUP_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${dirname(filePath).split('/').pop()}_${filePath.split('/').pop()}_${timestamp}`;
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

/**
 * Read all ~/.claude/sessions/*.json files and build a sessionId -> name lookup.
 * These small JSON files contain metadata for Claude Code sessions including
 * a "name" field that stores the resume/custom session name.
 */
async function loadSessionNameMap(): Promise<Map<string, string>> {
  const nameMap = new Map<string, string>();
  try {
    const files = await readdir(CLAUDE_SESSIONS_DIR, { withFileTypes: true });
    const jsonFiles = files.filter(f => f.isFile() && f.name.endsWith('.json'));

    const results = await Promise.all(
      jsonFiles.map(async (f) => {
        try {
          const content = await readFile(join(CLAUDE_SESSIONS_DIR, f.name), 'utf-8');
          const data = JSON.parse(content);
          if (data.sessionId && data.name) {
            return { sessionId: data.sessionId as string, name: data.name as string };
          }
        } catch {
          // skip unreadable/unparseable files
        }
        return null;
      })
    );

    for (const r of results) {
      if (r) nameMap.set(r.sessionId, r.name);
    }
  } catch {
    // sessions dir may not exist
  }
  return nameMap;
}

export class ClaudeAdapter implements Adapter {
  name = 'Claude Code';

  async detect(): Promise<boolean> {
    try {
      await access(CLAUDE_DIR);
      return true;
    } catch {
      return false;
    }
  }

  async listSessions(): Promise<Session[]> {
    try {
      const projectDirs = await readdir(CLAUDE_DIR, { withFileTypes: true });

      // Collect all file paths first
      const filesToParse: Array<{ filePath: string; project: string }> = [];

      for (const dir of projectDirs) {
        if (!dir.isDirectory()) continue;
        const projectPath = join(CLAUDE_DIR, dir.name);

        try {
          const files = await readdir(projectPath, { withFileTypes: true });
          for (const file of files) {
            if (!file.name.endsWith('.jsonl') || file.name.endsWith('.backup')) continue;
            filesToParse.push({
              filePath: join(projectPath, file.name),
              project: dir.name,
            });
          }
        } catch {
          // skip unreadable directories
        }
      }

      // Check mtime for each file, only re-parse changed ones
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

      // Parse changed files in parallel batches
      const batchSize = 10;
      for (let i = 0; i < needsParsing.length; i += batchSize) {
        const batch = needsParsing.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async ({ filePath, project, mtimeMs }) => {
            const session = await parseSessionFile(filePath);
            if (session) {
              session.project = project;
              sessionCache.set(filePath, { mtimeMs, session });
            }
            return session;
          })
        );
        for (const s of results) {
          if (s) sessions.push(s);
        }
      }

      // Clean stale cache entries
      const currentPaths = new Set(filesToParse.map(f => f.filePath));
      for (const key of sessionCache.keys()) {
        if (!currentPaths.has(key)) sessionCache.delete(key);
      }

      // Cross-reference session names from ~/.claude/sessions/*.json metadata
      const unnamed = sessions.filter(s => !s.name);
      if (unnamed.length > 0) {
        const nameMap = await loadSessionNameMap();
        if (nameMap.size > 0) {
          for (const s of unnamed) {
            const name = nameMap.get(s.id);
            if (name) {
              s.name = name;
              // Also update cache so we don't re-lookup next time
              const cached = sessionCache.get(s.filePath);
              if (cached) cached.session.name = name;
            }
          }
        }
      }

      return sessions;
    } catch {
      return [];
    }
  }

  private async findSessionFile(sessionId: string): Promise<string> {
    const projectDirs = await readdir(CLAUDE_DIR, { withFileTypes: true });
    for (const dir of projectDirs) {
      if (!dir.isDirectory()) continue;
      const filePath = join(CLAUDE_DIR, dir.name, `${sessionId}.jsonl`);
      try {
        await access(filePath);
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

    // If parser didn't find a custom-title, check session metadata files
    if (!detail.name) {
      const nameMap = await loadSessionNameMap();
      const name = nameMap.get(sessionId);
      if (name) detail.name = name;
    }

    return detail;
  }

  async getImageData(sessionId: string, imageId: string): Promise<ImageData> {
    const filePath = await this.findSessionFile(sessionId);
    const data = await getImageDataFromFile(filePath, imageId);
    if (!data) throw new Error(`Image ${imageId} not found in session ${sessionId}`);
    return data;
  }

  async stripImages(sessionId: string, imageIds: string[]): Promise<{ backupPath: string; bytesReclaimed: number }> {
    const detail = await this.getSessionDetail(sessionId);

    // Always create a timestamped backup first, verify it
    const backupPath = await createBackup(detail.filePath);

    const content = await readFile(detail.filePath, 'utf-8');
    const originalSize = Buffer.byteLength(content, 'utf-8');

    const idSet = new Set(imageIds);
    const { result, stripped } = stripImagesFromContent(content, idSet);

    if (stripped === 0) {
      return { backupPath, bytesReclaimed: 0 };
    }

    await writeFile(detail.filePath, result, 'utf-8');
    const newSize = Buffer.byteLength(result, 'utf-8');

    return { backupPath, bytesReclaimed: originalSize - newSize };
  }

  async stripAllImages(sessionId: string): Promise<{ backupPath: string; bytesReclaimed: number }> {
    const detail = await this.getSessionDetail(sessionId);

    // Always create a timestamped backup first, verify it
    const backupPath = await createBackup(detail.filePath);

    const content = await readFile(detail.filePath, 'utf-8');
    const originalSize = Buffer.byteLength(content, 'utf-8');

    const { result, stripped } = stripImagesFromContent(content, null);

    if (stripped === 0) {
      return { backupPath, bytesReclaimed: 0 };
    }

    await writeFile(detail.filePath, result, 'utf-8');
    const newSize = Buffer.byteLength(result, 'utf-8');

    return { backupPath, bytesReclaimed: originalSize - newSize };
  }

  async resizeImages(
    sessionId: string,
    imageIds: string[] | null,
    targetBytes: number,
  ): Promise<{ backupPath: string; bytesReclaimed: number }> {
    const filePath = await this.findSessionFile(sessionId);
    const backupPath = await createBackup(filePath);

    const content = await readFile(filePath, 'utf-8');
    const originalSize = Buffer.byteLength(content, 'utf-8');

    const idSet = imageIds ? new Set(imageIds) : null;
    const { result } = await resizeImagesInContent(content, idSet, targetBytes);

    await writeFile(filePath, result, 'utf-8');
    const newSize = Buffer.byteLength(result, 'utf-8');

    return { backupPath, bytesReclaimed: originalSize - newSize };
  }

  async restoreImage(sessionId: string, imageId: string, base64: string, mediaType: string): Promise<void> {
    const filePath = await this.findSessionFile(sessionId);
    await restoreImageData(filePath, imageId, base64, mediaType);
  }

  async getConversation(sessionId: string): Promise<ParsedConversation> {
    const filePath = await this.findSessionFile(sessionId);
    return parseConversation(filePath);
  }

  async getFileHistory(sessionId: string): Promise<FileHistory[]> {
    const filePath = await this.findSessionFile(sessionId);
    return parseFileHistory(filePath);
  }

  async getFileContent(sessionId: string, lineNumber: number): Promise<string | null> {
    const filePath = await this.findSessionFile(sessionId);
    return getFileContentFromFile(filePath, lineNumber);
  }

  async exportSession(sessionId: string): Promise<{ markdown: string; name: string | null }> {
    const filePath = await this.findSessionFile(sessionId);
    const markdown = await exportSessionMarkdown(filePath);

    // Get session name for the filename
    let name: string | null = null;
    const detail = await parseSessionDetail(filePath);
    if (detail?.name) {
      name = detail.name;
    } else {
      const nameMap = await loadSessionNameMap();
      name = nameMap.get(sessionId) ?? null;
    }

    return { markdown, name };
  }
}
