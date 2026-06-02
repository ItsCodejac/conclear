/**
 * Shared constants for session-reading adapters.
 *
 * Mirrors PATHS.backupDir in src/install/paths.ts. Kept separate so
 * adapters don't depend on the install module. Respects CONCLEAR_DEMO_ROOT
 * so fixture-driven demo runs don't pollute the real ~/.conclear/.
 */

import { join } from 'path';
import { effectiveHome } from './paths.js';

export const BACKUP_DIR = join(effectiveHome(), '.conclear', 'backups');
