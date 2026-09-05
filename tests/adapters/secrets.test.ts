/**
 * Round-trip tests for the shared secret-scanning module: for every pattern
 * in SECRET_PATTERNS, scan must find a representative fixture and redactText
 * must remove it so a rescan finds nothing. This is the invariant the UI
 * relies on — a finding with a Redact button must actually redact.
 */

import { describe, it, expect } from 'vitest';
import { SECRET_PATTERNS, scanText, redactText } from '../../src/server/adapters/secrets.js';

/** One representative fixture per pattern type, embedded in realistic text. */
const FIXTURES: Record<string, { text: string; secret: string }> = {
  api_key: {
    text: 'here is my key sk-ant-abcdefghijklmnopqrstuv1234 for the demo',
    secret: 'sk-ant-abcdefghijklmnopqrstuv1234',
  },
  aws_key: {
    text: 'export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
    secret: 'AKIAIOSFODNN7EXAMPLE',
  },
  aws_secret: {
    text: 'aws_secret is wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY please keep safe',
    secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  },
  private_key: {
    text: 'pasting -----BEGIN RSA PRIVATE KEY----- into the chat',
    secret: '-----BEGIN RSA PRIVATE KEY-----',
  },
  github_token: {
    text: 'auth with ghp_abcdefghijklmnopqrstuvwxyz0123456789 done',
    secret: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  },
  bearer_token: {
    text: 'curl -H "Authorization: Bearer abcdef0123456789abcdef0123456789"',
    secret: 'Bearer abcdef0123456789abcdef0123456789',
  },
  env_credential: {
    text: 'my .env has PASSWORD=hunter2supersecret in it',
    secret: 'PASSWORD=hunter2supersecret',
  },
  database_url: {
    text: 'connect via postgres://admin:s3cret@db.internal:5432/prod',
    secret: 'postgres://admin:s3cret@db.internal:5432/prod',
  },
  webhook_token: {
    text: 'post to https://hooks.example.com/services/abcdefghijklmnopqrstuvwx',
    secret: 'https://hooks.example.com/services/abcdefghijklmnopqrstuvwx',
  },
  env_file: {
    text: 'then I ran cat .env to check the values',
    secret: 'cat .env',
  },
  sensitive_path: {
    text: 'reading /home/me/credentials/aws.json for the keys',
    secret: '/credentials/',
  },
};

describe('secret patterns scan → redact round-trip', () => {
  it('has a fixture for every pattern in SECRET_PATTERNS', () => {
    const covered = new Set(Object.keys(FIXTURES));
    for (const p of SECRET_PATTERNS) {
      expect(covered.has(p.type), `missing fixture for pattern type "${p.type}"`).toBe(true);
    }
  });

  for (const [type, { text, secret }] of Object.entries(FIXTURES)) {
    it(`${type}: scan finds it, redact removes it, rescan finds nothing`, () => {
      const findings = scanText(text, 1, new Set());
      expect(findings.some(f => f.type === type), `scan should find ${type}`).toBe(true);

      const { text: redacted, replaced } = redactText(text, { type });
      expect(replaced, `redactText should replace at least one ${type} match`).toBeGreaterThanOrEqual(1);
      expect(redacted).not.toContain(secret);

      const rescan = scanText(redacted, 1, new Set());
      expect(
        rescan.filter(f => f.type === type),
        `rescan after redact should find no ${type}`,
      ).toEqual([]);
    });
  }

  it('full redact (no filter) clears every fixture in one combined text', () => {
    const combined = Object.values(FIXTURES).map(f => f.text).join('\n');
    const { text: redacted } = redactText(combined, null);
    const rescan = scanText(redacted, 1, new Set());
    expect(rescan).toEqual([]);
  });
});
