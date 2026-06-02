import { Adapter, Session, SessionDetail, ImageData, SearchResult } from '../types.js';
import type { CursorParsedConversation } from './parser.js';
import {
  parseAllSessions,
  parseSessionDetail,
  getImageData as getImageDataFromDb,
  stripImages as stripImagesInDb,
  restoreImage as restoreImageInDb,
  parseConversation,
  searchMessagesInDb,
} from './parser.js';
import { access, copyFile, stat as fsStat, mkdir } from 'fs/promises';
import { join } from 'path';
import { cursorDbPath } from '../paths.js';
import { BACKUP_DIR } from '../constants.js';

const CURSOR_DB_PATH = cursorDbPath();

async function createBackup(dbPath: string): Promise<string> {
  await mkdir(BACKUP_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `cursor_state.vscdb_${timestamp}`;
  const backupPath = join(BACKUP_DIR, fileName);

  await copyFile(dbPath, backupPath);

  // Verify backup integrity
  const [origStats, backupStats] = await Promise.all([fsStat(dbPath), fsStat(backupPath)]);
  if (origStats.size !== backupStats.size) {
    throw new Error(`Backup verification failed: size mismatch (${origStats.size} vs ${backupStats.size})`);
  }

  return backupPath;
}

// Cache: only re-parse when DB mtime changes
let sessionCacheMtime = 0;
let sessionCacheData: Session[] = [];

export class CursorAdapter implements Adapter {
  name = 'Cursor';

  clearCache(): void { sessionCacheMtime = 0; sessionCacheData = []; }


  async detect(): Promise<boolean> {
    try {
      await access(CURSOR_DB_PATH);
      return true;
    } catch {
      return false;
    }
  }

  async listSessions(): Promise<Session[]> {
    try {
      const stats = await fsStat(CURSOR_DB_PATH);
      if (stats.mtimeMs === sessionCacheMtime && sessionCacheData.length > 0) {
        return sessionCacheData;
      }

      const sessions = parseAllSessions(CURSOR_DB_PATH);

      // Update lastActiveAt from DB mtime for the most recent session
      // (individual bubble timestamps aren't stored, so DB mtime is our best proxy)
      if (sessions.length > 0) {
        // Sort by createdAt desc, give the newest one the DB mtime
        sessions.sort((a, b) => b.createdAt - a.createdAt);
        if (sessions[0].lastActiveAt < stats.mtimeMs) {
          sessions[0].lastActiveAt = stats.mtimeMs;
        }
      }

      sessionCacheMtime = stats.mtimeMs;
      sessionCacheData = sessions;

      return sessions;
    } catch (err) {
      console.error('CursorAdapter.listSessions error:', err);
      return [];
    }
  }

  async getSessionDetail(sessionId: string): Promise<SessionDetail> {
    const detail = parseSessionDetail(CURSOR_DB_PATH, sessionId);
    if (!detail) throw new Error(`Session ${sessionId} not found in Cursor database`);
    return detail;
  }

  async getImageData(sessionId: string, imageId: string): Promise<ImageData> {
    const data = getImageDataFromDb(CURSOR_DB_PATH, imageId);
    if (!data) throw new Error(`Image ${imageId} not found in Cursor session ${sessionId}`);
    return data;
  }

  async stripImages(
    sessionId: string,
    imageIds: string[],
  ): Promise<{ backupPath: string; bytesReclaimed: number }> {
    const backupPath = await createBackup(CURSOR_DB_PATH);
    const idSet = new Set(imageIds);
    const { stripped, bytesReclaimed } = stripImagesInDb(CURSOR_DB_PATH, sessionId, idSet);

    // Invalidate cache
    sessionCacheMtime = 0;

    return { backupPath, bytesReclaimed };
  }

  async stripAllImages(
    sessionId: string,
  ): Promise<{ backupPath: string; bytesReclaimed: number }> {
    const backupPath = await createBackup(CURSOR_DB_PATH);
    const { stripped, bytesReclaimed } = stripImagesInDb(CURSOR_DB_PATH, sessionId, null);

    // Invalidate cache
    sessionCacheMtime = 0;

    return { backupPath, bytesReclaimed };
  }

  async restoreImage(
    sessionId: string,
    imageId: string,
    base64: string,
    mediaType: string,
  ): Promise<void> {
    restoreImageInDb(CURSOR_DB_PATH, imageId, base64, mediaType);

    // Invalidate cache
    sessionCacheMtime = 0;
  }

  async getConversation(sessionId: string): Promise<CursorParsedConversation> {
    return parseConversation(CURSOR_DB_PATH, sessionId);
  }

  async searchMessages(query: string, limit: number): Promise<SearchResult[]> {
    const sessions = await this.listSessions();
    const sessionsByComposer = new Map<string, Session>();
    for (const s of sessions) sessionsByComposer.set(s.id, s);
    return searchMessagesInDb(CURSOR_DB_PATH, query, limit, sessionsByComposer);
  }
}
