import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The build the e2e run tests: the real site, under netlify.toml's enforced Content Security Policy,
 * with every /api document answered by the fixtures in e2e/fixtures.ts. Nothing reaches the
 * database, and a request to the Supabase host (the one the snapshot function reads,
 * netlify/lib/public-env.ts) fails the test. The Payment Link and the Discord invite are
 * placeholders the tests only read; the play URL is netlify.toml's own, the game's netlify.app
 * address, so the check that the site names no other netlify.app address (the board site's) meets
 * it as production does.
 */
const toml = readFileSync(fileURLToPath(new URL('../netlify.toml', import.meta.url)), 'utf8');

export { SUPABASE_URL } from '../netlify/lib/public-env.ts';
export const PAYMENT_LINK = 'https://buy.stripe.com/e2e_fixture_link';
export const DISCORD_INVITE = 'https://discord.gg/e2e-fixture';
const playUrl = toml.match(/^\s*VITE_PLAY_URL\s*=\s*"([^"]+)"/m)?.[1];
if (playUrl === undefined) throw new Error('netlify.toml has no VITE_PLAY_URL');
export const PLAY_URL = playUrl;

export const E2E_BUILD_ENV: Record<string, string> = {
  VITE_STRIPE_PAYMENT_LINK_URL: PAYMENT_LINK,
  VITE_DISCORD_INVITE: DISCORD_INVITE,
  VITE_PLAY_URL: PLAY_URL,
};

/** Each worktree or agent can set its own port, so two e2e runs never test each other's build. */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 4173);
export const E2E_ORIGIN = `http://127.0.0.1:${E2E_PORT}`;
