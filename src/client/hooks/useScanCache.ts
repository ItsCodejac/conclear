/**
 * Caches secret-scan results across page navigation.
 *
 * Backed by a module-level singleton store so any component (the global
 * Security page, the per-session SecurityTab, the sidebar count) shares
 * the same cache and doesn't trigger duplicate scans. Rehydrated from
 * localStorage on cold start so the UI has something to show instantly.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { SecretFinding, Session } from '../lib/types';
import { TOOLS } from '../lib/types';

const STORAGE_KEY = 'conclear.scanCache.v1';

interface ScanCache {
  results: Record<string, SecretFinding[]>;
  ts: Record<string, number>;
}

function loadCache(): ScanCache {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { results: {}, ts: {} };
}

function saveCache(c: ScanCache): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

// ---------- module-level singleton store ----------
let cache: ScanCache = loadCache();
const subscribers = new Set<() => void>();
const inFlight = new Set<string>();
let scanning = false;

function emit() {
  saveCache(cache);
  subscribers.forEach(fn => fn());
}

function subscribe(fn: () => void) {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

function getSnapshot() { return cache; }
function getScanningSnapshot() { return scanning; }

async function scanOne(id: string): Promise<void> {
  if (inFlight.has(id)) return;
  inFlight.add(id);
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/scan`);
    const findings = res.ok ? (await res.json()) as SecretFinding[] : [];
    cache = {
      results: { ...cache.results, [id]: findings },
      ts: { ...cache.ts, [id]: Date.now() },
    };
    emit();
  } catch { /* leave uncached so a later attempt can retry */ }
  finally {
    inFlight.delete(id);
  }
}

async function scanMany(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  scanning = true;
  emit();
  const queue = [...ids];
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const id = queue.shift();
      if (id) await scanOne(id);
    }
  });
  await Promise.all(workers);
  scanning = false;
  emit();
}

export interface RedactResult {
  ok: boolean;
  replaced: number;
  bytesReclaimed: number;
  error?: string;
}

async function redact(
  sessionId: string,
  filter: { lineNumber?: number; type?: string } | null,
): Promise<RedactResult> {
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/redact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filter ?? {}),
    });
    const data = await res.json() as { replaced?: number; bytesReclaimed?: number; error?: string };
    if (!res.ok) return { ok: false, replaced: 0, bytesReclaimed: 0, error: data.error };
    // Force a fresh scan for this session so the UI updates.
    invalidate(sessionId);
    await scanOne(sessionId);
    return { ok: true, replaced: data.replaced ?? 0, bytesReclaimed: data.bytesReclaimed ?? 0 };
  } catch (err) {
    return { ok: false, replaced: 0, bytesReclaimed: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

function invalidate(id: string): void {
  const r = { ...cache.results };
  const t = { ...cache.ts };
  delete r[id];
  delete t[id];
  cache = { results: r, ts: t };
  emit();
}

// ---------- hooks ----------

/** App-level: kicks off scans for the full session list and exposes aggregates. */
export function useScanCache(sessions: Session[]) {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const isScanning = useSyncExternalStore(subscribe, getScanningSnapshot, getScanningSnapshot);

  const refresh = useCallback(async (force = false) => {
    const scannable = sessions.filter(s => TOOLS[s.tool].caps.scanSecrets);
    if (force) scannable.forEach(s => invalidate(s.id));
    const need = scannable.filter(s => cache.results[s.id] === undefined).map(s => s.id);
    await scanMany(need);
  }, [sessions]);

  useEffect(() => { void refresh(); }, [refresh]);

  const totalFindings = Object.values(snap.results).reduce((s, arr) => s + arr.length, 0);
  const highSeverity = Object.values(snap.results).flat().filter(f => f.severity === 'high').length;
  const sessionsWithFindings = Object.entries(snap.results)
    .filter(([, arr]) => arr.length > 0)
    .map(([id]) => id);

  return {
    cache: snap,
    scanning: isScanning,
    refresh,
    invalidate,
    redact,
    totalFindings,
    highSeverity,
    sessionsWithFindings,
  };
}

/** Standalone redact for components that don't take the full cache. */
export const redactSession = redact;

/** Per-session: returns cached findings if present, kicks off one scan otherwise. */
export function useCachedScan(sessionId: string | null) {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const isScanning = useSyncExternalStore(subscribe, getScanningSnapshot, getScanningSnapshot);

  useEffect(() => {
    if (sessionId && cache.results[sessionId] === undefined) {
      void scanOne(sessionId);
    }
  }, [sessionId]);

  if (!sessionId) return { findings: null, loading: false };
  const cached = snap.results[sessionId];
  return {
    findings: cached ?? null,
    loading: cached === undefined || (isScanning && inFlight.has(sessionId)),
  };
}
