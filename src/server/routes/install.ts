/**
 * REST surface around the install lifecycle (src/install/).
 *
 * GET    /api/install/status            — every client's detect/install state
 * GET    /api/install/mcp               — ConClear's own MCP server info
 * POST   /api/install/:clientId/mcp     — install MCP for one client
 * DELETE /api/install/:clientId/mcp     — uninstall MCP for one client
 * POST   /api/install/:clientId/skill   — install Skill (where supported)
 * DELETE /api/install/:clientId/skill   — uninstall Skill
 *
 * Mirrors what the `conclear install` / `uninstall` / `doctor` CLI commands
 * do, exposed for the Connect page in the UI.
 */

import { Router, Request, Response } from 'express';
import { ADAPTERS, getAdapter } from '../../install/adapters.js';
import { PATHS } from '../../install/paths.js';

const router = Router();

function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : (val ?? '');
}

/** Every client's live detect + install state. */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const results = await Promise.all(
      ADAPTERS.map(async (a) => {
        try {
          const status = await a.status();
          return {
            id: a.id,
            name: a.displayName,
            method: a.method,
            supportsSkill: a.supportsSkill,
            detected: status.detected,
            mcpInstalled: status.mcpInstalled,
            skillInstalled: status.skillInstalled ?? false,
            notes: status.notes,
          };
        } catch (err) {
          return {
            id: a.id,
            name: a.displayName,
            method: a.method,
            supportsSkill: a.supportsSkill,
            detected: false,
            mcpInstalled: false,
            skillInstalled: false,
            notes: [`status check failed: ${err instanceof Error ? err.message : String(err)}`],
          };
        }
      }),
    );
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** ConClear's MCP server description (for the Connect page's "MCP server" panel). */
router.get('/mcp', (_req: Request, res: Response) => {
  res.json({
    // stdio MCP is spawned on demand by each client; there's no
    // persistent process to report status for. HTTP transport is
    // started manually with `conclear mcp --http`.
    stdioOnDemand: true,
    httpPort: 7331,
    tools: [
      { name: 'conclear_search',       desc: 'Search messages across all sessions by text query.' },
      { name: 'conclear_sessions',     desc: 'List sessions, most recently active first.' },
      { name: 'conclear_summary',      desc: 'Session digest: files touched + key user messages.' },
      { name: 'conclear_file_content', desc: 'Fetch a specific file version from a session.' },
      { name: 'conclear_context',      desc: 'Clean conversation text — no tool-result noise.' },
    ],
    entry: { mcpServers: { conclear: { command: 'conclear', args: ['mcp'] } } },
  });
});

/** Install MCP for a specific client. */
router.post('/:clientId/mcp', async (req: Request, res: Response) => {
  const adapter = getAdapter(param(req, 'clientId'));
  if (!adapter) return res.status(404).json({ error: 'unknown client' });
  try {
    const result = await adapter.installMcp();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, action: 'failed', error: err instanceof Error ? err.message : String(err) });
  }
});

router.delete('/:clientId/mcp', async (req: Request, res: Response) => {
  const adapter = getAdapter(param(req, 'clientId'));
  if (!adapter) return res.status(404).json({ error: 'unknown client' });
  try {
    const result = await adapter.uninstallMcp();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, action: 'failed', error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/:clientId/skill', async (req: Request, res: Response) => {
  const adapter = getAdapter(param(req, 'clientId'));
  if (!adapter) return res.status(404).json({ error: 'unknown client' });
  if (!adapter.installSkill) {
    return res.status(400).json({ ok: false, action: 'failed', error: `${adapter.displayName} does not support skills` });
  }
  try {
    const result = await adapter.installSkill();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, action: 'failed', error: err instanceof Error ? err.message : String(err) });
  }
});

router.delete('/:clientId/skill', async (req: Request, res: Response) => {
  const adapter = getAdapter(param(req, 'clientId'));
  if (!adapter) return res.status(404).json({ error: 'unknown client' });
  if (!adapter.uninstallSkill) {
    return res.status(400).json({ ok: false, action: 'failed', error: `${adapter.displayName} does not support skills` });
  }
  try {
    const result = await adapter.uninstallSkill();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, action: 'failed', error: err instanceof Error ? err.message : String(err) });
  }
});

/** Bulk: install MCP into every detected client. */
router.post('/install-detected', async (_req: Request, res: Response) => {
  const out: Array<{ id: string; ok: boolean; action: string }> = [];
  for (const a of ADAPTERS) {
    try {
      if (await a.detect()) {
        const r = await a.installMcp();
        out.push({ id: a.id, ok: r.ok, action: r.action });
      }
    } catch (err) {
      out.push({ id: a.id, ok: false, action: err instanceof Error ? err.message : String(err) });
    }
  }
  res.json(out);
});

/** Paths shown in the manual-config block (e.g. ~/.conclear/backups). */
router.get('/paths', (_req: Request, res: Response) => {
  res.json({ backupDir: PATHS.backupDir });
});

export default router;
