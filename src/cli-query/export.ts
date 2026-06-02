import { writeFile } from 'fs/promises';
import { findAdapterFor, resolveSession } from '../server/adapters/registry.js';
import { getOption } from './shared.js';

export async function cmdExport(args: string[]): Promise<void> {
  const outputFile = getOption(args, '--output') || getOption(args, '-o');
  const format = getOption(args, '--format', 'md');

  const query = args.join(' ').trim();
  if (!query) {
    process.stderr.write('Usage: conclear export <session-name-or-id> [--output <file>] [--format md|txt]\n');
    process.exit(1);
  }

  const session = await resolveSession(query);
  if (!session) {
    process.stderr.write(`Session not found: ${query}\n`);
    process.exit(1);
  }
  const adapter = await findAdapterFor(session);
  if (!adapter?.exportSession) {
    process.stderr.write(`Export is not yet supported for ${session.tool} sessions. Supported today: Claude Code.\n`);
    process.exit(1);
  }

  const { markdown } = await adapter.exportSession(session.id);
  let output = markdown;
  if (format === 'txt') {
    output = output
      .replace(/^#{1,3}\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/^> /gm, '  ')
      .replace(/```[^\n]*\n/g, '')
      .replace(/```/g, '');
  }

  if (outputFile) {
    await writeFile(outputFile, output, 'utf-8');
    process.stderr.write(`Exported to ${outputFile}\n`);
  } else {
    process.stdout.write(output);
  }
}
