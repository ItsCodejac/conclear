/**
 * Mock Connect-page data. Will be replaced by GET /api/install/status
 * once that endpoint exists (which wraps src/install/index.ts::runDoctor).
 */

export interface ClientStatus {
  id: string;
  name: string;
  method: 'cli' | 'file' | 'deeplink' | 'manual';
  supportsSkill: boolean;
  detected: boolean;
  mcpInstalled: boolean;
  skillInstalled: boolean;
  notes: string[];
}

export const CLIENTS: ClientStatus[] = [
  { id: 'claude-code',    name: 'Claude Code',         method: 'cli',    supportsSkill: true,  detected: true,  mcpInstalled: true,  skillInstalled: true,  notes: ['uses claude mcp add'] },
  { id: 'cursor',         name: 'Cursor',              method: 'file',   supportsSkill: true,  detected: true,  mcpInstalled: true,  skillInstalled: false, notes: ['skills since v2.2'] },
  { id: 'vscode',         name: 'VS Code (Copilot)',   method: 'cli',    supportsSkill: false, detected: true,  mcpInstalled: false, skillInstalled: false, notes: ['uses code --add-mcp'] },
  { id: 'cline',          name: 'Cline',               method: 'file',   supportsSkill: false, detected: true,  mcpInstalled: false, skillInstalled: false, notes: [] },
  { id: 'zed',            name: 'Zed',                 method: 'file',   supportsSkill: false, detected: true,  mcpInstalled: false, skillInstalled: false, notes: ['comments preserved (JSONC)'] },
  { id: 'claude-desktop', name: 'Claude Desktop',      method: 'file',   supportsSkill: false, detected: true,  mcpInstalled: false, skillInstalled: false, notes: ['restart required after install'] },
  { id: 'windsurf',       name: 'Windsurf',            method: 'file',   supportsSkill: false, detected: false, mcpInstalled: false, skillInstalled: false, notes: ['~100-tool cap'] },
  { id: 'antigravity',    name: 'Google Antigravity',  method: 'file',   supportsSkill: true,  detected: false, mcpInstalled: false, skillInstalled: false, notes: [] },
  { id: 'codex',          name: 'Codex CLI',           method: 'cli',    supportsSkill: false, detected: false, mcpInstalled: false, skillInstalled: false, notes: ['uses codex mcp add'] },
  { id: 'kiro',           name: 'Kiro CLI',            method: 'cli',    supportsSkill: false, detected: false, mcpInstalled: false, skillInstalled: false, notes: [] },
  { id: 'continue',       name: 'Continue',            method: 'manual', supportsSkill: false, detected: false, mcpInstalled: false, skillInstalled: false, notes: ['prints YAML snippet'] },
];

export const MCP_SERVER = {
  running: true,
  transport: 'stdio',
  httpRunning: false,
  httpPort: 7331,
  tools: [
    { name: 'conclear_search',       desc: 'Search messages across all sessions by text query.' },
    { name: 'conclear_sessions',     desc: 'List sessions, most recently active first.' },
    { name: 'conclear_summary',      desc: 'Session digest: files touched + key user messages.' },
    { name: 'conclear_file_content', desc: 'Fetch a specific file version from a session.' },
    { name: 'conclear_context',      desc: 'Clean conversation text — no tool-result noise.' },
  ],
  entry: { mcpServers: { conclear: { command: 'conclear', args: ['mcp'] } } },
};
