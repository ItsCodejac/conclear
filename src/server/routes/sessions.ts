import { Router, Request, Response } from 'express';
import { readdir, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { ClaudeAdapter } from '../adapters/claude/index.js';
import { GeminiAdapter } from '../adapters/gemini/index.js';
import { ClineAdapter } from '../adapters/cline/index.js';
import { CursorAdapter } from '../adapters/cursor/index.js';
import { CopilotAdapter } from '../adapters/copilot/index.js';
import type { Adapter, Session, SearchResult } from '../adapters/types.js';
import { searchSessionFile } from '../search.js';

// Express 5 params can be string | string[]
function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : (val ?? '');
}

const router = Router();
const adapters: Adapter[] = [new ClaudeAdapter(), new GeminiAdapter(), new ClineAdapter(), new CursorAdapter(), new CopilotAdapter()];
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

// ── Global search across all sessions ────────────────────────────────────────

router.get('/search', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string || '').trim();
    if (!q || q.length < 2) {
      res.json([]);
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const maxPerSession = 5;
    const queryLower = q.toLowerCase();

    // Gather all sessions from all adapters in parallel
    const adapterResults = await Promise.all(
      adapters.map(async (adapter) => {
        try {
          if (await adapter.detect()) {
            return await adapter.listSessions();
          }
        } catch {
          // skip failing adapter
        }
        return [] as Session[];
      })
    );
    const allSessions = adapterResults.flat();

    // Search all sessions in parallel (batched to avoid too many open file handles)
    const batchSize = 20;
    let allResults: SearchResult[] = [];

    for (let i = 0; i < allSessions.length; i += batchSize) {
      if (allResults.length >= limit) break;

      const batch = allSessions.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(session => searchSessionFile(session, queryLower, maxPerSession))
      );
      allResults.push(...batchResults.flat());
    }

    // Sort by timestamp (most recent first), results without timestamp go last
    allResults.sort((a, b) => {
      if (!a.timestamp && !b.timestamp) return 0;
      if (!a.timestamp) return 1;
      if (!b.timestamp) return -1;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    // Limit
    allResults = allResults.slice(0, limit);

    res.json(allResults);
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
          const messages = await (adapter as any).getConversation(param(req, 'id'));
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
          const files = await (adapter as any).getFileHistory(param(req, 'id'));
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
          const content = await (adapter as any).getFileContent(param(req, 'id'), lineNumber);
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
          const findings = await (adapter as any).scanSecrets(param(req, 'id'));
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

router.get('/sessions/:id/export', async (req: Request, res: Response) => {
  try {
    for (const adapter of adapters) {
      if (await adapter.detect()) {
        try {
          const { markdown, name } = await (adapter as any).exportSession(param(req, 'id'));
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
          const result = await (adapter as any).resizeImages(
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
    const filePath = join(BACKUP_DIR, param(req, 'name'));
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
