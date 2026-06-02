/**
 * Types for the conclear install/uninstall/doctor system.
 *
 * Each client has an adapter that knows how to install/uninstall/inspect
 * the ConClear MCP server (and optionally a Skill) for that client.
 */

export type InstallMethod = 'cli' | 'file' | 'deeplink' | 'manual';

export type ScopeKind = 'user' | 'project';

export interface ClientStatus {
  /** Client appears to be installed on this machine. */
  detected: boolean;
  /** ConClear MCP entry is present in the client's config. */
  mcpInstalled: boolean;
  /** ConClear Skill is present (only meaningful if client supports skills). */
  skillInstalled?: boolean;
  /** Human-readable notes (warnings, paths used, etc). */
  notes: string[];
}

export interface InstallResult {
  ok: boolean;
  /** What happened, in past tense, single line: e.g. "wrote ~/.cursor/mcp.json" */
  action: string;
  /** Optional follow-up the user must do (e.g. "restart Claude Desktop"). */
  followUp?: string;
  /** If install is manual-only, a printable instruction block. */
  manualInstructions?: string;
}

export interface ClientAdapter {
  /** Stable identifier, e.g. "claude-code". Used as the CLI flag (--claude-code). */
  id: string;
  /** Display name shown to the user, e.g. "Claude Code". */
  displayName: string;
  /** Preferred install method for this client. */
  method: InstallMethod;
  /** True if this client has a skills system ConClear can install into. */
  supportsSkill: boolean;
  /** Cross-platform sanity: only show on these platforms (omit = all). */
  platforms?: NodeJS.Platform[];

  /** Return whether the client appears installed on this machine. */
  detect(): Promise<boolean>;

  /** Install the ConClear MCP server entry for this client. */
  installMcp(): Promise<InstallResult>;
  /** Uninstall the ConClear MCP server entry for this client. */
  uninstallMcp(): Promise<InstallResult>;

  /** Install the ConClear Skill (no-op for clients that don't support skills). */
  installSkill?(): Promise<InstallResult>;
  uninstallSkill?(): Promise<InstallResult>;

  /** Inspect current install state. */
  status(): Promise<ClientStatus>;
}

/** Canonical ConClear MCP server entry — adapters translate to client-specific schema. */
export interface ConclearMcpEntry {
  name: 'conclear';
  command: string;
  args: string[];
}

export const CONCLEAR_ENTRY: ConclearMcpEntry = {
  name: 'conclear',
  command: 'conclear',
  args: ['mcp'],
};
