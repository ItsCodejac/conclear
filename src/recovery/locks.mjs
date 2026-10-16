import { DatabaseSync } from 'node:sqlite';
import { open } from 'node:fs/promises';

// SQLite transactions are single-host OS locks. The OS releases them on exit,
// including SIGKILL; there is no age-based lock stealing or stale PID to trust.
export async function acquireLease(path, { timeoutMs = 10000, message = 'Recovery store busy; retry' } = {}) {
  const handle = await open(path, 'a', 0o600);
  await handle.close();
  const db = new DatabaseSync(path);
  const deadline = performance.now() + timeoutMs;
  try {
    db.exec('PRAGMA busy_timeout=0');
    for (;;) {
      try { db.exec('BEGIN IMMEDIATE'); break; }
      catch (error) {
        if (!String(error.message).includes('locked') && !String(error.message).includes('busy')) throw error;
        if (performance.now() >= deadline) throw new Error(message);
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
  } catch (error) { db.close(); throw error; }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try { db.exec('ROLLBACK'); } finally { db.close(); }
  };
}
