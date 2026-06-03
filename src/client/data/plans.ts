/**
 * Plan definitions used by the Upgrade page in the free build.
 *
 * The full admin / teams mocks live in data/admin-mock.ts — that file
 * is intentionally kept in the source tree but is NOT imported by the
 * free-build entry point. Vite tree-shakes it out of the npm bundle.
 * When the Pro desktop / Teams tier comes online (v0.4+), the admin
 * module gets reattached to the app and PLANS continues to live here.
 */

export interface Plan {
  tier: 'free' | 'pro' | 'teams' | 'enterprise';
  name: string;
  price: number | null;
  unit: string;
  tagline: string;
  features: string[];
  popular?: boolean;
}

export const PLANS: Plan[] = [
  {
    tier: 'free',
    name: 'Free',
    price: 0,
    unit: 'forever',
    tagline: 'The npm CLI + web UI. Everything you need to manage your own sessions.',
    features: [
      'Session browser, image cleanup, file recovery',
      'Secret scanning + cross-tool search',
      'MCP server + 11-client one-tap install',
      'Backups, exports, and conversation replay',
      'Open source · MIT',
    ],
  },
  {
    tier: 'pro',
    name: 'Pro',
    price: null,
    unit: 'desktop',
    tagline: 'Native desktop app with AI features. For solo developers.',
    popular: true,
    features: [
      'Everything in Free',
      'AI-powered session summaries, ask anything across history',
      'BYOK — Claude, OpenAI, or local Ollama',
      'System tray, auto-update, native notifications',
      'Keys in OS keychain',
      'Single binary download',
    ],
  },
  {
    tier: 'teams',
    name: 'Teams',
    price: null,
    unit: 'per seat / mo',
    tagline: 'Shared governance for a whole team. Metadata sync; content stays local.',
    features: [
      'Everything in Pro',
      'Org-wide secret-leak dashboard',
      'Enforced cleanup & retention policies',
      'Fleet rollout & install status',
      'Aggregated usage & cost',
      'Audit log + SOC2/GDPR export',
    ],
  },
];
