import { searchConversations } from '../server/search.js';
import { getFlag, getOption, formatDate, truncate } from './shared.js';

export async function cmdSearch(args: string[]): Promise<void> {
  const json = getFlag(args, '--json');
  const projectFilter = getOption(args, '--project');
  const limitStr = getOption(args, '--limit', '10');
  if (!limitStr || !/^\d+$/.test(limitStr)) throw new Error('--limit requires an integer from 1 to 100');
  const limit = Number(limitStr);

  const query = args.join(' ').trim();
  if (!query) {
    process.stderr.write('Usage: conclear search <query> [--project <name>] [--limit <n>] [--json]\n');
    process.exit(1);
  }

  const data = await searchConversations(query, limit, projectFilter);
  const results = data.matches;

  if (json) {
    process.stdout.write(JSON.stringify(data) + '\n');
    return;
  }

  process.stdout.write(`Coverage: ${data.coverage.searchedSessions} sessions; ${data.coverage.omittedMatches} matches omitted; ${data.coverage.failedSourceCount} sources failed.\n`);
  if (results.length === 0) {
    process.stdout.write(`No results for "${query}"\n`);
    return;
  }

  process.stdout.write(`Found ${results.length} result(s) for "${query}":\n\n`);
  for (const r of results) {
    const name = r.sessionName ? truncate(r.sessionName, 40) : r.sessionId.slice(0, 12);
    process.stdout.write(`[${formatDate(r.timestamp)}] ${name}  (${r.tool}/${r.role})\n  ${r.text}\n  Session: ${r.sessionId}\n  Ref: ${r.messageRef} (tool=${r.tool}, matchOffset=${r.matchOffset})\n\n`);
  }
}
