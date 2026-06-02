import { listAllSessions } from '../server/adapters/registry.js';
import { getFlag, getOption, formatDate, formatBytes, truncate, decodeProjectDir } from './shared.js';

function padRow(name: string, tool: string, project: string, lastActive: string, msgs: string, imgs: string, size: string): string {
  return `${name.padEnd(34)} ${tool.padEnd(10)} ${project.padEnd(20)} ${lastActive.padEnd(18)} ${msgs.padStart(5)} ${imgs.padStart(5)} ${size.padStart(8)}`;
}

export async function cmdSessions(args: string[]): Promise<void> {
  const json = getFlag(args, '--json');
  const projectFilter = getOption(args, '--project');
  const limitStr = getOption(args, '--limit', '20');
  const limit = parseInt(limitStr!, 10) || 20;

  let sessions = await listAllSessions();
  if (projectFilter) {
    const p = projectFilter.toLowerCase();
    sessions = sessions.filter(s => s.project.toLowerCase().includes(p));
  }
  sessions = sessions.slice(0, limit);

  if (json) {
    const data = sessions.map(s => ({
      id: s.id,
      name: s.name,
      preview: s.preview,
      project: s.project,
      tool: s.tool,
      lastActive: new Date(s.lastActiveAt).toISOString(),
      messageCount: s.messageCount,
      imageCount: s.imageCount,
      size: s.totalSizeBytes,
      usage: s.usage,
    }));
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }

  if (sessions.length === 0) {
    process.stdout.write('No sessions found.\n');
    return;
  }

  const header = padRow('NAME', 'TOOL', 'PROJECT', 'LAST ACTIVE', 'MSGS', 'IMGS', 'SIZE');
  process.stdout.write(header + '\n');
  process.stdout.write('-'.repeat(header.length) + '\n');
  for (const s of sessions) {
    const name = truncate(s.name || s.preview || s.id.slice(0, 12), 32);
    const tool = truncate(s.tool, 8);
    const project = truncate(decodeProjectDir(s.project), 18);
    process.stdout.write(padRow(name, tool, project, formatDate(s.lastActiveAt), String(s.messageCount), String(s.imageCount), formatBytes(s.totalSizeBytes)) + '\n');
  }
}
