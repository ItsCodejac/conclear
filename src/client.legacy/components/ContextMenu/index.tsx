import * as CM from '@radix-ui/react-context-menu';
import styles from './styles.module.css';

const RESIZE_PRESETS = [
  { label: '50 KB', bytes: 50 * 1024 },
  { label: '100 KB', bytes: 100 * 1024 },
  { label: '200 KB', bytes: 200 * 1024 },
  { label: '500 KB', bytes: 500 * 1024 },
];

export const Root = CM.Root;
export const Trigger = CM.Trigger;

export function Content({ children }: { children: React.ReactNode }) {
  return (
    <CM.Portal>
      <CM.Content className={styles.content}>
        {children}
      </CM.Content>
    </CM.Portal>
  );
}

export function Item({ children, onSelect, danger }: {
  children: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
}) {
  return (
    <CM.Item
      className={danger ? styles.itemDanger : styles.item}
      onSelect={onSelect}
    >
      {children}
    </CM.Item>
  );
}

export function Separator() {
  return <CM.Separator className={styles.separator} />;
}

export function ResizeSubmenu({ onResize, label }: {
  onResize: (bytes: number) => void;
  label?: string;
}) {
  return (
    <CM.Sub>
      <CM.SubTrigger className={styles.subTrigger}>
        {label ?? 'Resize'}
        <span className={styles.subArrow}>{'\u203A'}</span>
      </CM.SubTrigger>
      <CM.Portal>
        <CM.SubContent className={styles.subContent} sideOffset={2}>
          {RESIZE_PRESETS.map(p => (
            <CM.Item
              key={p.bytes}
              className={styles.item}
              onSelect={() => onResize(p.bytes)}
            >
              {p.label}
            </CM.Item>
          ))}
        </CM.SubContent>
      </CM.Portal>
    </CM.Sub>
  );
}
