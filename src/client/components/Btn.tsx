import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '../lib/icons';
import { clsx } from '../lib/format';

interface Props {
  children?: ReactNode;
  icon?: Parameters<typeof Icon>[0]['name'];
  variant?: 'ghost' | 'primary' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  danger?: boolean;
  style?: CSSProperties;
}

export function Btn({ children, icon, variant = 'ghost', size = 'md', onClick, title, disabled, danger, style }: Props) {
  return (
    <button
      className={clsx('btn', `btn-${variant}`, `btn-${size}`, danger && 'btn-danger')}
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={style}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children && <span>{children}</span>}
    </button>
  );
}
