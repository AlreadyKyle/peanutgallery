import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The build the e2e run tests: the real site, built with the production Supabase URL so the enforced
 * Content Security Policy is exercised as it is in production, but with a key production refuses and
 * every request answered by the fixtures in e2e/fixtures.ts. Nothing reaches the database. The
 * Payment Link, the Discord invite and the play URL are placeholders the tests only read.
 */
const toml = readFileSync(fileURLToPath(new URL('../netlify.toml', import.meta.url)), 'utf8');
const supabaseUrl = toml.match(/^\s*VITE_SUPABASE_URL\s*=\s*"([^"]+)"/m)?.[1];
if (supabaseUrl === undefined) throw new Error('netlify.toml has no VITE_SUPABASE_URL');

export const SUPABASE_URL = supabaseUrl;
export const PAYMENT_LINK = 'https://buy.stripe.com/e2e_fixture_link';
export const DISCORD_INVITE = 'https://discord.gg/e2e-fixture';
export const PLAY_URL = 'https://play.e2e-fixture.invalid';

export const E2E_BUILD_ENV: Record<string, string> = {
  VITE_SUPABASE_URL: SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: 'e2e-fixture-key-refused-by-production',
  VITE_STRIPE_PAYMENT_LINK_URL: PAYMENT_LINK,
  VITE_DISCORD_INVITE: DISCORD_INVITE,
  VITE_PLAY_URL: PLAY_URL,
};

/** Each worktree or agent can set its own port, so two e2e runs never test each other's build. */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 4173);
export const E2E_ORIGIN = `http://127.0.0.1:${E2E_PORT}`;
