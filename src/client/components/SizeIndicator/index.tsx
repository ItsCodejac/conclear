import styles from './styles.module.css';

interface SizeIndicatorProps {
  totalBytes: number;
  imageBytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getStatus(imageBytes: number, totalBytes: number): 'clean' | 'review' | 'bloated' {
  if (imageBytes === 0) return 'clean';
  const ratio = imageBytes / totalBytes;
  if (ratio > 0.3 || imageBytes > 5 * 1024 * 1024) return 'bloated';
  if (imageBytes > 1024 * 1024) return 'review';
  return 'clean';
}

export function SizeIndicator({ totalBytes, imageBytes }: SizeIndicatorProps) {
  const status = getStatus(imageBytes, totalBytes);

  return (
    <span className={styles[status]}>
      {formatBytes(totalBytes)}
      {imageBytes > 0 && (
        <> ({formatBytes(imageBytes)} img)</>
      )}
    </span>
  );
}
