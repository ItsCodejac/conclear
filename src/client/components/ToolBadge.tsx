import { TOOLS, type ToolId } from '../lib/types';
import { clsx } from '../lib/format';

export function ToolBadge({ tool, size = 'sm' }: { tool: ToolId; size?: 'sm' | 'lg' }) {
  const t = TOOLS[tool];
  if (!t) return null;
  return (
    <span className={clsx('toolbadge', `tool-${tool}`, size === 'lg' && 'toolbadge-lg')}>
      <span className="toolbadge-dot" />
      {t.label}
    </span>
  );
}
