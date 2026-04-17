import { Router, Request, Response } from 'express';
import { readdir, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { ClaudeAdapter } from '../adapters/claude/index.js';
import type { Adapter } from '../adapters/types.js';

const router = Router();
const adapters: Adapter[] = [new ClaudeAdapter()];
const BACKUP_DIR = join(homedir(), '.conclear', 'backups');

router.get('/sessions', async (_req: Request, res: Response) => {
  try {
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

router.get('/sessions/:id', async (req: Request, res: Response) => {
  try {
    for (const adapter of adapters) {
      if (await adapter.detect()) {
        try {
          const detail = await adapter.getSessionDetail(req.params.id);
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
          const messages = await (adapter as any).getConversation(req.params.id);
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
          const data = await adapter.getImageData(req.params.id, req.params.imageId);
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

router.post('/sessions/:id/strip', async (req: Request, res: Response) => {
  try {
    const { imageIds } = req.body as { imageIds?: string[] };
    for (const adapter of adapters) {
      if (await adapter.detect()) {
        try {
          const result = imageIds?.length
            ? await adapter.stripImages(req.params.id, imageIds)
            : await adapter.stripAllImages(req.params.id);
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
          const result = await (adapter as any).resizeImages(
            req.params.id,
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
          await adapter.restoreImage(req.params.id, imageId, base64, mediaType);
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

router.get('/backups', async (_req: Request, res: Response) => {
  try {
    const files = await readdir(BACKUP_DIR).catch(() => []);
    const backups = await Promise.all(
      files.map(async (name) => {
        const filePath = join(BACKUP_DIR, name);
        const stats = await stat(filePath);
        return {
          name,
          sizeBytes: stats.size,
          createdAt: stats.birthtimeMs,
          path: filePath,
        };
      })
    );
    backups.sort((a, b) => b.createdAt - a.createdAt);
    res.json(backups);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete('/backups/:name', async (req: Request, res: Response) => {
  try {
    const filePath = join(BACKUP_DIR, req.params.name);
    await unlink(filePath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete('/backups', async (_req: Request, res: Response) => {
  try {
    const files = await readdir(BACKUP_DIR).catch(() => []);
    for (const name of files) {
      await unlink(join(BACKUP_DIR, name));
    }
    res.json({ ok: true, deleted: files.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
