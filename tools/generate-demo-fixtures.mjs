/**
 * Generates demo-fixtures/ — a synthetic directory tree that mimics every AI
 * tool's on-disk session layout, so `conclear --demo` shows interesting data
 * without exposing the developer's real sessions.
 *
 * Run with: node tools/generate-demo-fixtures.mjs
 * Output:   demo-fixtures/ at repo root (committed to git, shipped in npm tarball).
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { DatabaseSync } from 'node:sqlite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo-fixtures');

// ── Helpers ────────────────────────────────────────────────────────────────

function write(relPath, content) {
  const p = join(ROOT, relPath);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}

async function pngBase64(width, height, color = { r: 240, g: 240, b: 245 }) {
  const buf = await sharp({
    create: { width, height, channels: 3, background: color },
  }).png().toBuffer();
  return buf.toString('base64');
}

const day = (offset) => new Date(Date.now() - offset * 86_400_000).toISOString();
const min = (base, m) => new Date(new Date(base).getTime() + m * 60_000).toISOString();

// ── Claude Code fixtures (JSONL under .claude/projects/) ───────────────────

function claudeSession({ id, project, branch, lines }) {
  const file = `.claude/projects/${project}/${id}.jsonl`;
  write(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  return file;
}

function claudeUserMsg(sessionId, ts, text) {
  return {
    type: 'user',
    timestamp: ts,
    sessionId,
    message: { role: 'user', content: text },
  };
}

function claudeAssistantText(sessionId, ts, text) {
  return {
    type: 'assistant',
    timestamp: ts,
    sessionId,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  };
}

function claudeAssistantImageReq(sessionId, ts, text, base64, mediaType = 'image/png') {
  return {
    type: 'user',
    timestamp: ts,
    sessionId,
    message: {
      role: 'user',
      content: [
        { type: 'text', text },
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      ],
    },
  };
}

function claudeToolUseRead(sessionId, ts, id, path) {
  return {
    type: 'assistant',
    timestamp: ts,
    sessionId,
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: path } }],
    },
  };
}

function claudeToolResultRead(sessionId, ts, id, path, content) {
  return {
    type: 'user',
    timestamp: ts,
    sessionId,
    toolUseResult: { filePath: path, content },
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, content }],
    },
  };
}

function claudeToolUseEdit(sessionId, ts, id, path, oldStr, newStr) {
  return {
    type: 'assistant',
    timestamp: ts,
    sessionId,
    message: {
      role: 'assistant',
      content: [{
        type: 'tool_use', id, name: 'Edit',
        input: { file_path: path, old_string: oldStr, new_string: newStr },
      }],
    },
  };
}

function claudeToolUseWrite(sessionId, ts, id, path, content) {
  return {
    type: 'assistant',
    timestamp: ts,
    sessionId,
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id, name: 'Write', input: { file_path: path, content } }],
    },
  };
}

// ── Session-name registry (~/.claude/sessions/<uuid>.json) ─────────────────

function claudeSessionName(id, customTitle) {
  write(`.claude/sessions/${id}.json`, JSON.stringify({ customTitle }, null, 2));
}

// ── Cline fixture (api_conversation_history.json) ──────────────────────────

function clineTask(taskId, taskTitle, messages, metadata) {
  const dir = `Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/tasks/${taskId}`;
  write(`${dir}/api_conversation_history.json`, JSON.stringify(messages, null, 2));
  write(`${dir}/task_metadata.json`, JSON.stringify({ task: taskTitle, ...metadata }, null, 2));
}

// ── Cursor fixture (state.vscdb SQLite) ────────────────────────────────────

function cursorSqlite() {
  const dbPath = join(ROOT, 'Library/Application Support/Cursor/User/globalStorage/state.vscdb');
  mkdirSync(dirname(dbPath), { recursive: true });
  rmSync(dbPath, { force: true });

  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB);
    CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB);
  `);

  const composerId = '11111111-2222-3333-4444-555555555555';
  const userBubbleId = 'bubble-user-1';
  const assistantBubbleId = 'bubble-asst-1';

  const composerData = {
    _v: 1,
    composerId,
    text: '',
    richText: '',
    fullConversationHeadersOnly: [
      { bubbleId: userBubbleId, type: 1 },
      { bubbleId: assistantBubbleId, type: 2 },
    ],
    conversationMap: {},
    createdAt: Date.now() - 2 * 86_400_000,
    unifiedMode: 'agent',
    modelConfig: { modelName: 'claude-4.6-sonnet' },
    context: {
      fileSelections: [{ uri: 'file:///Users/demo/projects/atlas/src/routes/auth.ts' }],
    },
  };

  const userBubble = {
    _v: 3,
    type: 1,
    bubbleId: userBubbleId,
    text: 'Wire up the OAuth callback route to actually exchange the auth code for tokens. Right now it just logs the code and returns 200.',
    images: [],
    toolResults: [],
    allThinkingBlocks: [],
    suggestedCodeBlocks: [],
  };

  const assistantBubble = {
    _v: 3,
    type: 2,
    bubbleId: assistantBubbleId,
    text: "I'll wire up the token exchange. Looking at the current handler:\n\n```ts\n// src/routes/auth.ts — current\napp.get('/oauth/callback', (req, res) => {\n  console.log('code:', req.query.code);\n  res.status(200).send();\n});\n```\n\nReplacing with a real exchange against the IdP's `/token` endpoint and persisting the access/refresh tokens to the session store.",
    images: [],
    toolResults: [],
    allThinkingBlocks: [],
    suggestedCodeBlocks: [],
  };

  const insert = db.prepare('INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)');
  insert.run(`composerData:${composerId}`, JSON.stringify(composerData));
  insert.run(`bubbleId:${composerId}:${userBubbleId}`, JSON.stringify(userBubble));
  insert.run(`bubbleId:${composerId}:${assistantBubbleId}`, JSON.stringify(assistantBubble));

  db.close();
}

// ── Build the fixtures ─────────────────────────────────────────────────────

async function main() {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });

  const smallPng = await pngBase64(220, 140);                 // a regular screenshot
  const oversizedPng = await pngBase64(2400, 200);            // triggers the >2000px warning

  // ─── Session A: bloated screenshot session (Claude Code) ────────────────
  const sessionA = randomUUID();
  const aStart = day(0);
  claudeSession({
    id: sessionA,
    project: '-Users-demo-projects-atlas',
    branch: 'main',
    lines: [
      claudeUserMsg(sessionA, aStart, 'Help me build a landing page hero. Here are some references:'),
      claudeAssistantImageReq(sessionA, min(aStart, 1), '(reference 1)', smallPng),
      claudeAssistantImageReq(sessionA, min(aStart, 2), '(reference 2)', smallPng),
      claudeAssistantImageReq(sessionA, min(aStart, 3), 'And the current state:', oversizedPng),
      claudeAssistantText(sessionA, min(aStart, 4), "I see the references. I'll draft a hero with a centered headline, supporting subhead, and a primary CTA. Let me put together a first pass."),
      claudeAssistantImageReq(sessionA, min(aStart, 8), 'Heres another angle:', smallPng),
      claudeAssistantImageReq(sessionA, min(aStart, 9), 'And here:', smallPng),
      claudeUserMsg(sessionA, min(aStart, 12), 'Tighter spacing in the second variation please'),
      claudeAssistantText(sessionA, min(aStart, 13), 'Tightening — reducing the vertical rhythm between subhead and CTA by 8px and dropping the section padding from 96 to 72.'),
    ],
  });
  claudeSessionName(sessionA, 'atlas hero design pass');

  // ─── Session B: heavy file ops (Claude Code) ────────────────────────────
  const sessionB = randomUUID();
  const bStart = day(1);
  const oldRouter = "import express from 'express';\nconst app = express();\napp.get('/health', (_, res) => res.json({ ok: true }));\nexport default app;\n";
  const newRouter = "import express from 'express';\nimport { authRouter } from './routes/auth.js';\nimport { sessionsRouter } from './routes/sessions.js';\nconst app = express();\napp.use('/auth', authRouter);\napp.use('/sessions', sessionsRouter);\napp.get('/health', (_, res) => res.json({ ok: true }));\nexport default app;\n";
  const userQuery = "Add an /auth router with an /oauth/callback route that exchanges the code for tokens. Wire it into src/router.ts.";
  const newAuthFile = "import { Router } from 'express';\nimport { exchangeCode } from '../oauth.js';\n\nexport const authRouter = Router();\n\nauthRouter.get('/oauth/callback', async (req, res) => {\n  const code = req.query.code as string;\n  if (!code) return res.status(400).json({ error: 'missing code' });\n  const tokens = await exchangeCode(code);\n  req.session.tokens = tokens;\n  res.redirect('/');\n});\n";

  claudeSession({
    id: sessionB,
    project: '-Users-demo-projects-atlas',
    branch: 'auth-router',
    lines: [
      claudeUserMsg(sessionB, bStart, userQuery),
      claudeToolUseRead(sessionB, min(bStart, 1), 'tool-1', '/Users/demo/projects/atlas/src/router.ts'),
      claudeToolResultRead(sessionB, min(bStart, 1), 'tool-1', '/Users/demo/projects/atlas/src/router.ts', oldRouter),
      claudeAssistantText(sessionB, min(bStart, 2), 'Got it. Creating the auth router first, then wiring it into router.ts.'),
      claudeToolUseWrite(sessionB, min(bStart, 3), 'tool-2', '/Users/demo/projects/atlas/src/routes/auth.ts', newAuthFile),
      claudeToolUseEdit(sessionB, min(bStart, 4), 'tool-3', '/Users/demo/projects/atlas/src/router.ts', oldRouter, newRouter),
      claudeAssistantText(sessionB, min(bStart, 5), "Done. `/auth/oauth/callback` now exchanges the code via `exchangeCode()` and stores tokens on the session. Health route is untouched."),
      claudeUserMsg(sessionB, min(bStart, 12), 'Also add a logout route that clears the session tokens'),
      claudeToolUseEdit(sessionB, min(bStart, 13), 'tool-4', '/Users/demo/projects/atlas/src/routes/auth.ts',
        "authRouter.get('/oauth/callback', async (req, res) => {",
        "authRouter.post('/logout', (req, res) => {\n  req.session.tokens = undefined;\n  res.status(204).end();\n});\n\nauthRouter.get('/oauth/callback', async (req, res) => {"),
      claudeAssistantText(sessionB, min(bStart, 14), 'Added `POST /auth/logout` above the callback. Clears `req.session.tokens` and returns 204.'),
    ],
  });
  claudeSessionName(sessionB, 'atlas auth router + logout');

  // ─── Session C: short discussion (Claude Code) ──────────────────────────
  const sessionC = randomUUID();
  const cStart = day(3);
  claudeSession({
    id: sessionC,
    project: '-Users-demo-projects-pilot',
    branch: 'main',
    lines: [
      claudeUserMsg(sessionC, cStart, 'Whats the best way to model a webhook retry queue in Postgres? We want at-least-once and exponential backoff.'),
      claudeAssistantText(sessionC, min(cStart, 1), 'Two viable patterns:\n\n1. **`SELECT FOR UPDATE SKIP LOCKED`** on a `webhook_deliveries` table with columns for `next_attempt_at`, `attempts`, `payload`, and `status`. Workers grab a batch, lock them, do the HTTP call, then update.\n\n2. **Use `pg_cron` or a sidecar scheduler** to enqueue ready rows into a NOTIFY channel. Workers LISTEN and pull.\n\nFor at-least-once + exponential backoff, the first one is simpler. Backoff goes in `next_attempt_at = now() + interval \'1 minute\' * power(2, attempts)`.'),
      claudeUserMsg(sessionC, min(cStart, 4), 'Yeah lets go with option 1. What does the worker loop look like?'),
      claudeAssistantText(sessionC, min(cStart, 5), "```sql\nUPDATE webhook_deliveries\nSET attempts = attempts + 1, status = 'in_flight', locked_at = now()\nWHERE id IN (\n  SELECT id FROM webhook_deliveries\n  WHERE status = 'pending' AND next_attempt_at <= now()\n  ORDER BY next_attempt_at\n  FOR UPDATE SKIP LOCKED\n  LIMIT 10\n)\nRETURNING *;\n```\n\nThen the worker POSTs, and on failure: `UPDATE ... SET status = 'pending', next_attempt_at = now() + ...`."),
    ],
  });
  claudeSessionName(sessionC, 'webhook retry queue design');

  // ─── Session D: a small one to round out the list ──────────────────────
  const sessionD = randomUUID();
  const dStart = day(5);
  claudeSession({
    id: sessionD,
    project: '-Users-demo-projects-atlas',
    branch: 'docs',
    lines: [
      claudeUserMsg(sessionD, dStart, 'rewrite the README intro to lead with the integration story'),
      claudeAssistantText(sessionD, min(dStart, 1), 'Drafted:\n\n> Atlas plugs into your existing API surface. Drop the middleware in, point it at your IdP, and your routes get session-aware auth in one line.'),
      claudeUserMsg(sessionD, min(dStart, 3), 'good. ship it'),
    ],
  });
  claudeSessionName(sessionD, 'atlas README rewrite');

  // ─── Cline session ──────────────────────────────────────────────────────
  const clineTaskId = 'demo-cline-task-1';
  clineTask(
    clineTaskId,
    'Add rate limiting to the public API endpoints',
    [
      { role: 'user', content: 'Add a token-bucket rate limiter to the public REST endpoints in src/server/. 60 req/min per IP, 429 on overflow.' },
      {
        role: 'assistant', content: [
          { type: 'text', text: "I'll read the server entry to see how middleware is wired today." },
          { type: 'tool_use', id: 'c-1', name: 'read_file', input: { path: 'src/server/index.ts' } },
        ],
      },
      {
        role: 'user', content: [{
          type: 'tool_result', tool_use_id: 'c-1', content: "import express from 'express';\nimport router from './router.js';\nconst app = express();\napp.use(express.json());\napp.use(router);\napp.listen(3000);\n",
        }],
      },
      {
        role: 'assistant', content: [
          { type: 'text', text: 'Creating a rate-limit middleware and wiring it into the public router.' },
          { type: 'tool_use', id: 'c-2', name: 'write_to_file', input: { path: 'src/server/rate-limit.ts', content: "import type { RequestHandler } from 'express';\n\nconst buckets = new Map<string, { tokens: number; ts: number }>();\nconst CAP = 60;\nconst REFILL_PER_MS = CAP / 60_000;\n\nexport const rateLimit: RequestHandler = (req, res, next) => {\n  const key = req.ip ?? 'unknown';\n  const now = Date.now();\n  const b = buckets.get(key) ?? { tokens: CAP, ts: now };\n  b.tokens = Math.min(CAP, b.tokens + (now - b.ts) * REFILL_PER_MS);\n  b.ts = now;\n  if (b.tokens < 1) return res.status(429).json({ error: 'rate limited' });\n  b.tokens -= 1;\n  buckets.set(key, b);\n  next();\n};\n" } },
        ],
      },
      {
        role: 'assistant', content: [
          { type: 'tool_use', id: 'c-3', name: 'replace_in_file', input: { path: 'src/server/index.ts', diff: "<<<<<<< SEARCH\napp.use(express.json());\napp.use(router);\n=======\napp.use(express.json());\napp.use(rateLimit);\napp.use(router);\n>>>>>>> REPLACE" } },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'Done. 60 req/min/IP, 429 on overflow. Refill is continuous so steady traffic just under the cap goes through cleanly.' }] },
    ],
    { tokensIn: 4823, tokensOut: 1192, cacheReads: 3104, cacheWrites: 1719, totalCost: 0.0173 },
  );

  // ─── Cursor session ─────────────────────────────────────────────────────
  cursorSqlite();

  process.stdout.write(`Wrote demo fixtures to ${ROOT}\n`);
}

main().catch(err => {
  process.stderr.write(`generate-demo-fixtures failed: ${err?.stack || err}\n`);
  process.exit(1);
});
