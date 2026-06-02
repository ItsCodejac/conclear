/**
 * Shared constants for session-reading adapters.
 *
 * Mirrors PATHS.backupDir in src/install/paths.ts. Kept separate so
 * adapters don't depend on the install module.
 */

import { join } from 'path';
import { homedir } from 'os';

export const BACKUP_DIR = join(homedir(), '.conclear', 'backups');
