import { findAdapterFor, resolveSession } from '../server/adapters/registry.js';
import type { SecretFinding } from '../server/adapters/types.js';
import { getFlag } from './shared.js';

function severityLabel(s: string): string {
  if (s === 'high') return '\x1b[91mHIGH\x1b[0m';
  if (s === 'medium') return '\x1b[93mMEDIUM\x1b[0m';
  return '\x1b[90mLOW\x1b[0m';
}

export async function cmdScan(args: string[]): Promise<void> {
  const json = getFlag(args, '--json');
  const query = args.join(' ').trim();
  if (!query) {
    process.stderr.write('Usage: conclear scan <session-name-or-id> [--json]\n');
    process.exit(1);
  }

  const session = await resolveSession(query);
  if (!session) {
    process.stderr.write(`Session not found: ${query}\n`);
    process.exit(1);
  }
  const adapter = await findAdapterFor(session);
  if (!adapter?.scanSecrets) {
    process.stderr.write(`Secret scanning is not yet supported for ${session.tool} sessions. Supported today: Claude Code.\n`);
    process.exit(1);
  }

  const findings: SecretFinding[] = await adapter.scanSecrets(session.id);
  if (json) {
    process.stdout.write(JSON.stringify(findings, null, 2) + '\n');
    return;
  }
  if (findings.length === 0) {
    process.stdout.write('No secrets detected.\n');
    return;
  }

  const high = findings.filter(f => f.severity === 'high').length;
  const medium = findings.filter(f => f.severity === 'medium').length;
  const low = findings.filter(f => f.severity === 'low').length;

  process.stdout.write(`Scan results for "${session.name || session.preview || session.id}":\n`);
  process.stdout.write(`${high} high, ${medium} medium, ${low} low findings\n\n`);

  for (const f of findings) {
    process.stdout.write(`  ${severityLabel(f.severity)}  ${f.type}  line ${f.lineNumber}\n`);
    process.stdout.write(`    pattern: ${f.pattern}\n`);
    process.stdout.write(`    context: ${f.context}\n\n`);
  }
}
