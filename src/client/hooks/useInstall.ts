import { useCallback, useEffect, useState } from 'react';

export interface InstallStatus {
  id: string;
  name: string;
  method: 'cli' | 'file' | 'deeplink' | 'manual';
  supportsSkill: boolean;
  detected: boolean;
  mcpInstalled: boolean;
  skillInstalled: boolean;
  notes: string[];
}

export interface McpServerInfo {
  /** stdio MCP is spawned on demand by each client; no persistent process. */
  stdioOnDemand: boolean;
  /** Port that `conclear mcp --http` would bind to. */
  httpPort: number;
  tools: Array<{ name: string; desc: string }>;
  entry: unknown;
}

export interface ActionResult {
  ok: boolean;
  action: string;
  followUp?: string;
  manualInstructions?: string;
  error?: string;
}

export function useInstall() {
  const [clients, setClients] = useState<InstallStatus[]>([]);
  const [mcp, setMcp] = useState<McpServerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, mcpRes] = await Promise.all([
        fetch('/api/install/status'),
        fetch('/api/install/mcp'),
      ]);
      if (statusRes.ok) setClients(await statusRes.json());
      if (mcpRes.ok) setMcp(await mcpRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function call(method: 'POST' | 'DELETE', url: string, key: string): Promise<ActionResult> {
    setActing(key);
    try {
      const res = await fetch(url, { method });
      const data = await res.json() as ActionResult;
      return { ok: res.ok && data.ok !== false, ...data };
    } catch (err) {
      return { ok: false, action: 'request failed', error: err instanceof Error ? err.message : String(err) };
    } finally {
      setActing(null);
    }
  }

  const installMcp     = (id: string) => call('POST',   `/api/install/${id}/mcp`,   `${id}:mcp:install`);
  const uninstallMcp   = (id: string) => call('DELETE', `/api/install/${id}/mcp`,   `${id}:mcp:uninstall`);
  const installSkill   = (id: string) => call('POST',   `/api/install/${id}/skill`, `${id}:skill:install`);
  const uninstallSkill = (id: string) => call('DELETE', `/api/install/${id}/skill`, `${id}:skill:uninstall`);

  async function installAllDetected(): Promise<ActionResult[]> {
    setActing('bulk');
    try {
      const res = await fetch('/api/install/install-detected', { method: 'POST' });
      return await res.json();
    } finally {
      setActing(null);
    }
  }

  return {
    clients, mcp, loading, acting, refresh,
    installMcp, uninstallMcp, installSkill, uninstallSkill, installAllDetected,
  };
}
