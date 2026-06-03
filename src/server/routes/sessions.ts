import { Router, Request, Response } from 'express';
import { readdir, stat, unlink, readFile, copyFile } from 'fs/promises';
import type { Session, SearchResult } from '../adapters/types.js';
import { ADAPTERS as adapters, clearAllCaches } from '../adapters/registry.js';
import { BACKUP_DIR } from '../adapters/constants.js';
import { searchAllAdapters } from '../search.js';
import { join } from 'path';

// Express 5 params can be string | string[]
function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : (val ?? '');
}

const router = Router();

router.get('/sessions', async (req: Request, res: Response) => {
  try {
    if (req.query.refresh === 'true') clearAllCaches();
    const allSessions = [];
    for (const adapter of adapters) {
      if (await adapter.detect()) {
        const sessions = await adapter.listSessions();
        allSessions.push(...sessions);
      }
    }
    allSessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    res.json(allSessions);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Global search across all sessions ────────────────────────────────────────

router.get('/search', async (req: Request, res: Response) => {
  try {
    if (req.query.refresh === 'true') clearAllCaches();
    const q = (req.query.q as string || '').trim();
    if (!q || q.length < 2) {
      res.json([]);
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const project = typeof req.query.project === 'string' ? req.query.project : undefined;
    const results = await searchAllAdapters(q, limit, project);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/sessions/:id', async (req: Request, res: Response) => {
  try {
    for (const adapter of adapters) {
      if (await adapter.detect()) {
        try {
          const detail = await adapter.getSessionDetail(param(req, 'id'));
          res.json(detail);
          return;
        } catch {
          // try next adapter
        }
      }
    }
    res.status(404).json({ error: 'Session not found' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/sessions/:id/conversation', async (req: Request, res: Response) => {
  try {
    for (const adapter of adapters) {
      if (await adapter.detect()) {
        try {
          const messages = await adapter.getConversation(param(req, 'id'));
          res.json(messages);
          return;
        } catch {
          // try next adapter
        }
      }
    }
    res.status(404).json({ error: 'Session not found' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/sessions/:id/images/:imageId', async (req: Request, res: Response) => {
  try {
    for (const adapter of adapters) {
      if (await adapter.detect()) {
        try {
          const data = await adapter.getImageData(param(req, 'id'), param(req, 'imageId'));
          const buffer = Buffer.from(data.base64, 'base64');
          res.set('Content-Type', data.mediaType);
          res.set('Cache-Control', 'private, max-age=300');
          res.send(buffer);
          return;
        } catch {
          // try next adapter
        }
      }
    }
    res.status(404).json({ error: 'Image not found' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/sessions/:id/files', async (req: Request, res: Response) => {
  try {
    for (const adapter of adapters) {
      if (await adapter.detect()) {
        try {
          if (!adapter.getFileHistory) throw new Error('not supported');
          const files = await adapter.getFileHistory(param(req, 'id'));
          res.json(files);
          return;
        } catch {
          // try next adapter
        }
      }
    }
    res.status(404).json({ error: 'Session not found' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/sessions/:id/files/:lineNumber', async (req: Request, res: Response) => {
  try {
    const lineNumber = parseInt(param(req, 'lineNumber'), 10);
    if (isNaN(lineNumber) || lineNumber < 0) {
      res.status(400).json({ error: 'Invalid line number' });
      return;
    }
    for (const adapter of adapters) {
      if (await adapter.detect()) {
        try {
          if (!adapter.getFileContent) throw new Error('not supported');
          const content = await adapter.getFileContent(param(req, 'id'), lineNumber);
          if (content === null) {
            res.status(404).json({ error: 'Content not found at line' });
            return;
          }
          res.json({ content });
          return;
        } catch {
          // try next adapter
        }
      }
    }
    res.status(404).json({ error: 'Session not found' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/sessions/:id/scan', async (req: Request, res: Response) => {
  try {
    for (const adapter of adapters) {
      if (await adapter.detect()) {
        try {
          if (!adapter.scanSecrets) throw new Error('not supported');
          const findings = await adapter.scanSecrets(param(req, 'id'));
          res.json(findings);
          return;
        } catch {
          // try next adapter
        }
      }
    }
    res.status(404).json({ error: 'Session not found' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/sessions/:id/redact', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { lineNumber?: number; type?: string };
    const filter = (body.lineNumber != null || body.type) ? body : null;
    for (const adapter of adapters) {
      if (await adapter.detect()) {
        try {
          if (!adapter.redactSecrets) throw new Error('not supported');
          const result = await adapter.redactSecrets(param(req, 'id'), filter);
          res.json(result);
          return;
        } catch {
          // try next adapter
        }
      }
    }
    res.status(404).json({ error: 'Session not found or adapter does not support redact' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/sessions/:id/export', async (req: Request, res: Response) => {
  try {
    for (const adapter of adapters) {
      if (await adapter.detect()) {
        try {
          if (!adapter.exportSession) throw new Error('not supported');
          const { markdown, name } = await adapter.exportSession(param(req, 'id'));
          const safeName = (name || param(req, 'id'))
            .replace(/[^a-zA-Z0-9_\- ]/g, '')
            .replace(/\s+/g, '-')
            .slice(0, 80);
          res.set('Content-Type', 'text/markdown; charset=utf-8');
          res.set('Content-Disposition', `attachment; filename="${safeName}.md"`);
          res.send(markdown);
          return;
        } catch {
          // try next adapter
        }
      }
    }
    res.status(404).json({ error: 'Session not found' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/sessions/:id/strip', async (req: Request, res: Response) => {
  try {
    const { imageIds } = req.body as { imageIds?: string[] };
    for (const adapter of adapters) {
      if (await adapter.detect()) {
        try {
          const result = imageIds?.length
            ? await adapter.stripImages(param(req, 'id'), imageIds)
            : await adapter.stripAllImages(param(req, 'id'));
          res.json(result);
          return;
        } catch {
          // try next adapter
        }
      }
    }
    res.status(404).json({ error: 'Session not found' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/sessions/:id/resize', async (req: Request, res: Response) => {
  try {
    const { imageIds, targetBytes } = req.body as { imageIds?: string[]; targetBytes: number };
    if (!targetBytes || targetBytes < 1024) {
      res.status(400).json({ error: 'targetBytes must be at least 1024' });
      return;
    }
    for (const adapter of adapters) {
      if (await adapter.detect()) {
        try {
          if (!adapter.resizeImages) throw new Error('not supported');
          const result = await adapter.resizeImages(
            param(req, 'id'),
            imageIds?.length ? imageIds : null,
            targetBytes,
          );
          res.json(result);
          return;
        } catch {
          // try next adapter
        }
      }
    }
    res.status(404).json({ error: 'Session not found' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/sessions/:id/restore', async (req: Request, res: Response) => {
  try {
    const { imageId, base64, mediaType } = req.body as {
      imageId: string;
      base64: string;
      mediaType: string;
    };
    for (const adapter of adapters) {
      if (await adapter.detect()) {
        try {
          await adapter.restoreImage(param(req, 'id'), imageId, base64, mediaType);
          res.json({ ok: true });
          return;
        } catch {
          // try next adapter
        }
      }
    }
    res.status(404).json({ error: 'Session not found' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Backup management

interface BackupMeta { origPath?: string; action?: string; createdAt?: number }

async function readMeta(backupPath: string): Promise<BackupMeta | null> {
  try {
    const raw = await readFile(`${backupPath}.meta.json`, 'utf-8');
    return JSON.parse(raw) as BackupMeta;
  } catch { return null; }
}

router.get('/backups', async (_req: Request, res: Response) => {
  try {
    const all = await readdir(BACKUP_DIR).catch(() => []);
    // Sidecars are an implementation detail; the UI only sees the real backups.
    const files = all.filter(n => !n.endsWith('.meta.json'));
    const backups = await Promise.all(
      files.map(async (name) => {
        const filePath = join(BACKUP_DIR, name);
        const stats = await stat(filePath);
        const meta = await readMeta(filePath);
        return {
          name,
          sizeBytes: stats.size,
          createdAt: stats.birthtimeMs,
          path: filePath,
          origPath: meta?.origPath,
          action: meta?.action,
          canRestore: meta?.origPath != null,
        };
      })
    );
    backups.sort((a, b) => b.createdAt - a.createdAt);
    res.json(backups);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/backups/:name/restore', async (req: Request, res: Response) => {
  try {
    const name = param(req, 'name');
    const filePath = join(BACKUP_DIR, name);
    const meta = await readMeta(filePath);
    if (!meta?.origPath) {
      res.status(400).json({ error: 'No restore target recorded for this backup (legacy backup pre-0.3.2). Restore manually from ~/.conclear/backups.' });
      return;
    }
    // Sanity check: the original parent directory should still exist before we clobber.
    try {
      await stat(meta.origPath.substring(0, meta.origPath.lastIndexOf('/')));
    } catch {
      res.status(400).json({ error: `Original directory no longer exists: ${meta.origPath}` });
      return;
    }
    await copyFile(filePath, meta.origPath);
    res.json({ ok: true, restoredTo: meta.origPath });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete('/backups/:name', async (req: Request, res: Response) => {
  try {
    const filePath = join(BACKUP_DIR, param(req, 'name'));
    await unlink(filePath);
    // Best-effort sidecar cleanup.
    await unlink(`${filePath}.meta.json`).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete('/backups', async (_req: Request, res: Response) => {
  try {
    const files = await readdir(BACKUP_DIR).catch(() => []);
    for (const name of files) {
      await unlink(join(BACKUP_DIR, name)).catch(() => {});
    }
    res.json({ ok: true, deleted: files.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
