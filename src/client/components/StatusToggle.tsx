import { clsx } from '../lib/format';

export function StatusToggle({ on, label, onClick, disabled }: {
  on: boolean; label: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      className={clsx('stoggle', on && 'on', disabled && 'dis')}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      <span className="stoggle-track"><span className="stoggle-knob" /></span>
      <span>{label}</span>
    </button>
  );
}
