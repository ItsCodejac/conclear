import { searchAllAdapters } from '../server/search.js';
import { getFlag, getOption, formatDate, truncate } from './shared.js';

export async function cmdSearch(args: string[]): Promise<void> {
  const json = getFlag(args, '--json');
  const projectFilter = getOption(args, '--project');
  const limitStr = getOption(args, '--limit', '10');
  const limit = parseInt(limitStr!, 10) || 10;

  const query = args.join(' ').trim();
  if (!query) {
    process.stderr.write('Usage: conclear search <query> [--project <name>] [--limit <n>] [--json]\n');
    process.exit(1);
  }

  const results = await searchAllAdapters(query, limit, projectFilter);

  if (json) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    return;
  }

  if (results.length === 0) {
    process.stdout.write(`No results for "${query}"\n`);
    return;
  }

  process.stdout.write(`Found ${results.length} result(s) for "${query}":\n\n`);
  for (const r of results) {
    const name = r.sessionName ? truncate(r.sessionName, 40) : r.sessionId.slice(0, 12);
    process.stdout.write(`[${formatDate(r.timestamp)}] ${name}  (${r.tool}/${r.role})\n  ${r.text}\n\n`);
  }
}
