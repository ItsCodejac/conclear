/**
 * ConClear CLI query commands — barrel re-export.
 *
 * Each command lives in its own file under src/cli-query/. All route through
 * the multi-adapter registry so search / sessions / summary / context / files
 * / export / scan see every detected AI tool (Claude Code, Cursor, Cline /
 * Roo Code, Gemini, Copilot).
 *
 * Where an adapter doesn't support a feature (file history is Claude / Cline
 * only today, scan / export are Claude only), the CLI prints a brief
 * explanation instead of throwing.
 */

export { cmdSearch } from './cli-query/search.js';
export { cmdFiles } from './cli-query/files.js';
export { cmdSessions } from './cli-query/sessions.js';
export { cmdSummary } from './cli-query/summary.js';
export { cmdContext } from './cli-query/context.js';
export { cmdExport } from './cli-query/export.js';
export { cmdScan } from './cli-query/scan.js';
export { getFlag, getOption } from './cli-query/shared.js';
