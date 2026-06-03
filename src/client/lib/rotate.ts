/**
 * Maps a secret finding's `type` (set by the scanner in
 * src/server/adapters/claude/parser.ts) to a provider rotation URL.
 *
 * Redacting a leaked credential removes it from the session file but the
 * credential is still valid wherever it was issued. The Security UI shows
 * a "rotate at …" link next to each finding so the user closes the loop.
 *
 * Keep this small and accurate. We'd rather omit a link than send the user
 * somewhere wrong.
 */

interface RotationTarget {
  label: string;
  url: string;
}

const ROTATION_MAP: Record<string, RotationTarget> = {
  api_key:       { label: 'Rotate OpenAI / Anthropic key',  url: 'https://platform.openai.com/api-keys' },
  aws_key:       { label: 'Rotate AWS access key',          url: 'https://console.aws.amazon.com/iam/home#/security_credentials' },
  aws_secret:    { label: 'Rotate AWS secret',              url: 'https://console.aws.amazon.com/iam/home#/security_credentials' },
  github_token:  { label: 'Rotate GitHub token',            url: 'https://github.com/settings/tokens' },
  private_key:   { label: 'Reissue & re-key SSH key',       url: 'https://github.com/settings/keys' },
  bearer_token:  { label: 'Rotate this bearer token',       url: '' },
  database_url:  { label: 'Rotate database credentials',    url: '' },
  webhook_token: { label: 'Regenerate webhook secret',      url: '' },
  env_credential:{ label: 'Rotate the credential in .env',  url: '' },
};

/** Returns the rotation target for a finding type, or null if we don't have one. */
export function rotationFor(type: string): RotationTarget | null {
  const t = ROTATION_MAP[type];
  if (!t) return null;
  return t;
}
