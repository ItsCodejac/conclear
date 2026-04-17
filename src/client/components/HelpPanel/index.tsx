import { useEffect } from 'react';
import styles from './styles.module.css';

interface HelpPanelProps {
  visible: boolean;
  onClose: () => void;
}

export function HelpPanel({ visible, onClose }: HelpPanelProps) {
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Help</span>
          <div className={styles.spacer} />
          <button className={styles.closeBtn} onClick={onClose}>ESC</button>
        </div>
        <div className={styles.body}>

          {/* Getting started */}
          <div className={styles.section}>
            <h3 className={styles.sectionHeading}>Getting Started</h3>
            <p className={styles.text}>
              ConClear scans your AI coding sessions and shows how much disk space they use.
              Click a session in the left pane to see its images, timeline, and chat.
              Switch to the Images tab to preview what's stored, then use Strip or Resize
              to reclaim space.
            </p>
          </div>

          {/* Keyboard shortcuts */}
          <div className={styles.section}>
            <h3 className={styles.sectionHeading}>Keyboard Shortcuts</h3>
            <table className={styles.shortcutTable}>
              <tbody>
                <tr>
                  <td className={styles.keyCol}><span className={styles.kbd}>/</span></td>
                  <td>Focus search input</td>
                </tr>
                <tr>
                  <td className={styles.keyCol}>
                    <span className={styles.kbd}>Up</span>{' / '}
                    <span className={styles.kbd}>Down</span>
                  </td>
                  <td>Navigate session list</td>
                </tr>
                <tr>
                  <td className={styles.keyCol}><span className={styles.kbd}>Enter</span></td>
                  <td>Select focused session</td>
                </tr>
                <tr>
                  <td className={styles.keyCol}><span className={styles.kbd}>Escape</span></td>
                  <td>Close expanded view, lightbox, or clear search</td>
                </tr>
                <tr>
                  <td className={styles.keyCol}>
                    <span className={styles.kbd}>Cmd+R</span>{' / '}
                    <span className={styles.kbd}>Ctrl+R</span>
                  </td>
                  <td>Refresh session list</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Interactions */}
          <div className={styles.section}>
            <h3 className={styles.sectionHeading}>Interactions</h3>
            <p className={styles.text}>
              <strong>Single click</strong> a session row to select it and load its detail in the right pane.
            </p>
            <p className={styles.text}>
              <strong>Double-click</strong> a session to expand it to a full-width detail view.
            </p>
            <p className={styles.text}>
              <strong>Right-click</strong> a session row or an image for a context menu with
              quick actions (strip, resize, copy commands).
            </p>
            <p className={styles.text}>
              <strong>Drag the divider</strong> between panes to resize them.
            </p>
            <p className={styles.text}>
              <strong>Click a thumbnail</strong> to expand it inline.
              Click again to open the fullscreen lightbox.
            </p>
          </div>

          {/* Operations explained */}
          <div className={styles.section}>
            <h3 className={styles.sectionHeading}>Operations Explained</h3>

            <p className={styles.dt}>Strip</p>
            <p className={styles.dd}>
              Replaces the image data in the session file with a 1x1 pixel placeholder.
              The original bytes are gone from disk, but a backup of the full session file
              is created first. The image data is also held in an in-memory cache so you
              can recover it during the current viewing session.
            </p>

            <p className={styles.dt}>Resize</p>
            <p className={styles.dd}>
              Re-encodes the image to fit within a target file size (e.g. 100KB).
              The visual content is preserved at reduced quality. This modifies the
              session file directly. A backup is created first.
            </p>

            <p className={styles.dt}>Recover</p>
            <p className={styles.dd}>
              Restores a stripped image from the in-memory cache. Only available until
              you navigate to a different session or refresh the page. After that, use
              the backup file to restore manually.
            </p>
          </div>

          {/* Backups */}
          <div className={styles.section}>
            <h3 className={styles.sectionHeading}>Backups</h3>
            <p className={styles.text}>
              Before every strip or resize operation, ConClear copies the original session file
              to <span className={styles.path}>~/.conclear/backups/</span>.
              You can view and manage backups from the Backups button in the toolbar.
              Backups accumulate until you delete them, so check periodically.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
