/**
 * Cross-platform path resolution for AI tool data directories.
 *
 * Demo mode: when CONCLEAR_DEMO_ROOT is set in the environment, every path
 * is rerooted at that directory. Adapters then read fixture data instead
 * of the user's real session stores. Used by `conclear --demo` to drive a
 * predictable UI for screenshots and the project's online demo.
 */
import { join } from 'path';
import { homedir } from 'os';

/** Returns CONCLEAR_DEMO_ROOT when set, otherwise the user's home. */
export function effectiveHome(): string {
  const demo = process.env.CONCLEAR_DEMO_ROOT;
  return demo && demo.length > 0 ? demo : homedir();
}

/** True if we're running against fixture data, not the real filesystem. */
export function isDemoMode(): boolean {
  return !!process.env.CONCLEAR_DEMO_ROOT;
}

/**
 * Returns the VS Code / Cursor app data base directory.
 *
 * In demo mode we always use the macOS layout under the demo root so a
 * single fixture tree works on every host OS — adapters are unaware.
 */
function appDataDir(app: string): string {
  const home = effectiveHome();
  if (isDemoMode()) {
    return join(home, 'Library', 'Application Support', app);
  }
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
