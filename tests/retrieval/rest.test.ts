import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../../src/server/adapters/registry.js', () => {
  const adapter = { getConversation: async (_id: string, options?: { fullText?: boolean }) => ({ timeline: [], messages: [
    { id: '1', role: 'user', text: options?.fullText ? 'full evidence' : 'preview', hasImage: false },
  ] }) };
  return {
    ADAPTERS: [], clearAllCaches: vi.fn(), findAdapterFor: async () => adapter,
    resolveSession: async (id: string, tool?: string) => id === 's' && (!tool || tool === 'claude') ? { id, tool: 'claude' } : null,
  };
});
import router from '../../src/server/routes/sessions.js';

function request(query: Record<string, unknown>) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    let status = 200;
    const req = { method: 'GET', url: '/sessions/s/context', query } as unknown as Request;
    const res = { status: (n: number) => { status = n; return res; }, json: (body: unknown) => resolve({ status, body }) } as unknown as Response;
    router(req, res, (err?: unknown) => reject(err ?? new Error('Route not handled')));
  });
}

describe('REST context', () => {
  it('uses full text and the shared page contract', async () => {
    const result = await request({ tool: 'claude', maxChars: '256' });
    expect(result.status).toBe(200);
    expect(result.body.messages[0].text).toBe('full evidence');
    expect(result.body.page.complete).toBe(true);
  });
  it('rejects malformed query options', async () => {
    expect((await request({ limit: '1.5' })).status).toBe(400);
    expect((await request({ around: ['invalid'] })).status).toBe(400);
  });
  it('honors the tool qualifier', async () => {
    expect((await request({ tool: 'cursor' })).status).toBe(404);
  });
});
