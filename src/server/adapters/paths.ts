/**
 * Cross-platform path resolution for AI tool data directories.
 */
import { join } from 'path';
import { homedir } from 'os';

/**
 * Returns the VS Code / Cursor app data base directory.
 * - macOS: ~/Library/Application Support/<app>/
 * - Windows: %APPDATA%/<app>/
 * - Linux: ~/.config/<app>/
 */
function appDataDir(app: string): string {
  const home = homedir();
  switch (process.platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', app);
    case 'win32':
      return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), app);
    default: // linux and others
      return join(home, '.config', app);
  }
}

/** VS Code globalStorage directory */
export function vscodeGlobalStorage(): string {
  return join(appDataDir('Code'), 'User', 'globalStorage');
}

/** VS Code workspaceStorage directory */
export function vscodeWorkspaceStorage(): string {
  return join(appDataDir('Code'), 'User', 'workspaceStorage');
}

/** Cursor state.vscdb path */
export function cursorDbPath(): string {
  return join(appDataDir('Cursor'), 'User', 'globalStorage', 'state.vscdb');
}
