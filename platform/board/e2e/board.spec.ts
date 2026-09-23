import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type Route } from '@playwright/test';
import { SUPABASE_URL } from './fixture-env';

// vite preview sends netlify.toml's headers (vite.config.ts), so every page here loads under the
// board's enforced Content Security Policy. Any report fails the test. Supabase is never reached:
// every request to the project is answered here.
const toml = readFileSync(fileURLToPath(new URL('../netlify.toml', import.meta.url)), 'utf8');
const enforced = toml.match(/^\s*Content-Security-Policy\s*=\s*"([^"]*)"/m)?.[1] ?? '';
const host = new URL(SUPABASE_URL).host;
const storageKey = `sb-${host.split('.')[0]}-auth-token`;
const EMAIL = 'board@peanutgallery.games';

async function watchPolicy(page: Page): Promise<string[]> {
  const reports: string[] = [];
  await page.exposeFunction('e2ePolicyReport', (line: string) => reports.push(line));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { e2ePolicyReport: (line: string) => void }).e2ePolicyReport(
        `${event.disposition} ${event.effectiveDirective} ${event.blockedURI || 'inline'} on ${location.pathname}`,
      );
    });
  });
  return reports;
}

function base64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * A stored session for a board member, the way supabase-js keeps one after the magic link: aal1, or
 * aal2 once a code from the authenticator app has been verified.
 */
async function signIn(page: Page, aal: 'aal1' | 'aal2' = 'aal1') {
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: 'u-board', email: EMAIL, role: 'authenticated', aal, amr: [{ method: 'otp', timestamp: now }], exp: now + 3600, session_id: 's-1' };
  const session = {
    access_token: `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(payload)}.c2lnbmF0dXJl`,
    refresh_token: 'e2e-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user: { id: 'u-board', aud: 'authenticated', email: EMAIL, app_metadata: {}, user_metadata: {}, created_at: '2026-09-14T00:00:00Z', factors: [] },
  };
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key!, value!), [storageKey, JSON.stringify(session)]);
}

const needsYou = {
  controller: {
    finished_at: '2026-09-24T07:07:00Z',
    ok: true,
    mismatches: 0,
    credit_purchase_usd: 12.5,
    minimum_balance_usd: 3.25,
    settlement_amount: 4.5,
    settlement_currency: 'cad',
    disputes_to_answer: [{ dispute: 'du_e2e', status: 'needs_response', due_by: '2026-10-01', amount_usd: 5 }],
    latest_payout: { id: 'po_e2e', arrival_date: '2026-09-23' },
  },
  last_credit_purchase: null,
  incident_reserve_usd: 0.4,
  s1_cards: [],
};

const studio = {
  paused: true,
  paused_by: EMAIL,
  paused_at: '2026-09-23T00:00:00Z',
  agent_mode: 'attended',
  launched_at: null,
  dispatcher_seen_at: null,
  daily_cap_usd: 100,
  card_max_usd: 25,
  agent_hourly_rate_usd: 5,
  monthly_cap_usd: 500,
  credit_studio_daily_cap_usd: 500,
  anthropic_tier_cap_usd: null,
  platform_lane_open: false,
  cooling_window_minutes: 0,
};

// docs/specs/agent-system-core.md: an approved agent card waiting on next to be dealt, which only a
// board member's session reads (cards_board_read); anon's policy (card_is_public) hides no approved
// card, but the e2e fixture answers the cards read only with the signed-in board member's token.
const UNDEALT = {
  id: '6b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e',
  title: 'Faster gatherers after the first unlock',
  stage: 'proposed',
  horizon: 'next',
  rank: 1,
  folder: 'seed-1',
  lane: 'config',
  funding_target_usd: '3.0000',
  funded_usd: '0.0000',
  estimate_usd: '3.0000',
  created_at: '2026-09-23T00:00:00Z',
  source: 'agent',
  drafter_role_id: 'r-designer',
  opens_at: '2026-09-25T12:00:00Z',
  board_vetoed: false,
  board_veto_reason: null,
};

const ROLES = [
  { id: 'r-director', name: 'Game Director', agent_class: 'reviewer', state: 'active', paused: false, paused_reason: null },
  { id: 'r-qa', name: 'QA', agent_class: 'writer', state: 'active', paused: true, paused_reason: 'Checking the gate' },
];

const JOBS = [
  {
    name: 'tidy_up',
    role_name: null,
    calls_model: false,
    runs_when_paused: true,
    description: null,
    runs: [{ id: 'run-e2e', origin: 'schedule', status: 'skipped', reason: 'role_paused', created_at: '2026-09-23T10:00:00Z', finished_at: '2026-09-23T10:00:01Z' }],
  },
  // The two role jobs (docs/specs/agent-workflows.md), each with a finished run's typed output.
  {
    name: 'draft_card',
    role_name: 'Game Designer',
    calls_model: true,
    runs_when_paused: true,
    description: 'Draft a game card: the Game Designer drafts a new seed-1 card, the checks run, and the Game Director grades it; up to three rounds.',
    runs: [
      {
        id: 'draft-e2e',
        origin: 'board',
        status: 'succeeded',
        reason: null,
        created_at: '2026-09-23T11:00:00Z',
        finished_at: '2026-09-23T11:06:00Z',
        output: {
          result: 'approved',
          card_id: '22222222-2222-4222-8222-222222222222',
          rounds: [{ round: 1, draft: { title: 'Gatherers cost 11', summary: 'The gatherer costs one more to build.', lane: 'config', executor: 'Builder A', estimate_usd: 0.5 }, check: null, verdict: { result: 'approved', reason_codes: ['fits_pillars'] } }],
        },
      },
    ],
  },
  {
    name: 'studio_ranking',
    role_name: 'Studio Head',
    calls_model: true,
    runs_when_paused: true,
    description: 'Rank now: the Studio Head orders the open cards on now that hold no money; at most ten changes a run.',
    runs: [
      {
        id: 'rank-e2e',
        origin: 'board',
        status: 'succeeded',
        reason: null,
        created_at: '2026-09-23T12:00:00Z',
        finished_at: '2026-09-23T12:02:00Z',
        output: { moves: [{ card_id: '11111111-1111-4111-8111-111111111111', from: 2, to: 1 }], unapplied: 0 },
      },
    ],
  },
];

// A small SVG, as Supabase Auth returns it before supabase-js turns it into a data: URL.
const QR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="black"/></svg>';

async function answerSupabase(page: Page, seen: string[], bodies: Record<string, unknown>[] = []) {
  await page.route(`${SUPABASE_URL}/**`, async (route: Route) => {
    const url = new URL(route.request().url());
    seen.push(`${route.request().method()} ${url.pathname}`);
    const body = route.request().postData();
    if (body) bodies.push({ path: url.pathname, body: JSON.parse(body) });
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    switch (url.pathname) {
      case '/auth/v1/user':
        return json({ id: 'u-board', aud: 'authenticated', email: EMAIL, app_metadata: {}, user_metadata: {}, created_at: '2026-09-14T00:00:00Z', factors: [] });
      case '/auth/v1/factors':
        return json({ id: 'f-e2e', type: 'totp', friendly_name: '', totp: { qr_code: QR_SVG, secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/e2e' } });
      case '/rest/v1/rpc/board_role':
        return json('board');
      case '/rest/v1/rpc/board_heartbeat':
        return json(new Date().toISOString());
      case '/rest/v1/rpc/board_studio_state':
        return json(studio);
      case '/rest/v1/rpc/board_needs_you':
        return json(needsYou);
      case '/rest/v1/rpc/board_roles':
        return json(ROLES);
      case '/rest/v1/rpc/board_jobs':
        return json(JOBS);
      case '/rest/v1/rpc/card_is_public':
        return json(true);
      case '/rest/v1/rpc/enqueue_manual_job':
        return json('run-queued-e2e');
      case '/rest/v1/rpc/set_card_veto':
        return json({ card_id: UNDEALT.id, board_vetoed: true, horizon: 'next', opens_at: UNDEALT.opens_at });
      case '/rest/v1/public_roles':
        return json([]);
      case '/rest/v1/cards': {
        // Only the board member's own token reads the undealt card, as cards_board_read allows.
        const bearer = route.request().headers()['authorization'] ?? '';
        return json(bearer.includes('.') && bearer.split('.').length === 3 ? [UNDEALT] : []);
      }
      default:
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"not in the e2e fixtures"}' });
    }
  });
}

test('the preview sends the enforced policy, the robots header and the frame rules from netlify.toml', async ({ page }) => {
  expect(enforced).toBe(
    `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src https://${host}; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
  );
  const response = await page.goto('/');
  const headers = response?.headers() ?? {};
  expect(headers['content-security-policy']).toBe(enforced);
  expect(headers['content-security-policy-report-only']).toBeUndefined();
  expect(headers['x-robots-tag']).toBe('noindex, nofollow');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('no-referrer');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  const robots = await page.request.get('/robots.txt');
  expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n');
});

test('the sign-in form renders at 375 px with no horizontal overflow and no policy report', async ({ page }) => {
  const reports = await watchPolicy(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Board' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send sign-in link' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(reports).toEqual([]);
});

test('a signed-in board member sees Needs you first, and sets up an authenticator app, under the enforced policy', async ({ page }) => {
  const reports = await watchPolicy(page);
  const seen: string[] = [];
  await answerSupabase(page, seen);
  await signIn(page);
  await page.goto('/');

  const inbox = page.getByRole('region', { name: 'Needs you' });
  await expect(inbox).toBeVisible();
  await expect(inbox.getByText('Answer dispute du_e2e for $5.00 by 1 Oct 2026.')).toBeVisible();
  await expect(inbox.getByText('Buy $12.50 of Console credit.')).toBeVisible();
  await expect(inbox.getByText('Verify your second factor, then fill in the record form from here.', { exact: false })).toBeVisible();
  // Needs you is the first section on the page, above the two-factor step.
  const sections = await page.locator('main section').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
  expect(sections[0]).toBe('Needs you');

  await page.getByRole('button', { name: 'Set up an authenticator app' }).click();
  const qr = page.getByRole('img', { name: 'QR code for your authenticator app' });
  await expect(qr).toBeVisible();
  expect(await qr.evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0)).toBe(true);
  expect(await qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml;utf-8,<svg /);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  expect(seen).toContain('POST /rest/v1/rpc/board_needs_you');
  expect(seen).toContain('POST /auth/v1/factors');
  expect(reports).toEqual([]);
});

test('a connection to any host but the Supabase project is refused', async ({ page }) => {
  const reports = await watchPolicy(page);
  await page.route('https://example.com/**', (route) => route.abort());
  await page.goto('/');
  const outcomes = await page.evaluate(async () => {
    const attempt = (url: string) => fetch(url, { method: 'POST', body: 'x' }).then(() => 'sent', () => 'refused');
    return [await attempt('https://example.com/collect'), await attempt(`${location.origin}/collect`)];
  });
  expect(outcomes).toEqual(['refused', 'refused']);
  await expect.poll(() => reports).toContainEqual('enforce connect-src https://example.com/collect on /');
});

test('at the second factor the board sees and vetoes an undealt agent card, and reads the roles, the jobs and the cooling window, under the enforced policy', async ({ page }) => {
  const reports = await watchPolicy(page);
  const seen: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  await answerSupabase(page, seen, bodies);
  await signIn(page, 'aal2');
  await page.goto('/');

  const card = page.getByRole('form', { name: `Card ${UNDEALT.title}` });
  await expect(card).toBeVisible();
  await expect(card.getByText('Written by an agent; its approval is current.')).toBeVisible();
  await expect(card.getByText(/^Waiting to be dealt: moves to now at /)).toBeVisible();
  await card.getByLabel('Reason').fill('Not this week');
  await card.getByRole('button', { name: 'Veto card' }).click();
  await expect(card.getByText('Card vetoed.')).toBeVisible();
  expect(bodies).toContainEqual({ path: '/rest/v1/rpc/set_card_veto', body: { p_card: UNDEALT.id, p_vetoed: true, p_reason: 'Not this week' } });

  const roles = page.getByRole('region', { name: 'Roles' });
  await expect(roles.getByText('reviewer · not paused', { exact: false })).toBeVisible();
  await expect(roles.getByRole('button', { name: 'Resume QA' })).toBeVisible();
  const jobs = page.getByRole('region', { name: 'Jobs' });
  await expect(jobs.getByText('schedule · skipped: role_paused', { exact: false })).toBeVisible();
  await expect(jobs.getByRole('button', { name: 'Run now' })).toBeVisible();
  // Rank now and Draft a game card queue board-origin runs with {}, and each run shows its typed output.
  const rank = page.getByRole('form', { name: 'Job studio_ranking' });
  await expect(rank.getByText('Moved 11111111 from 2 to 1.')).toBeVisible();
  await rank.getByLabel('Reason').fill('New cards on now');
  await rank.getByRole('button', { name: 'Rank now' }).click();
  await expect(rank.getByText('Queued. It runs while a board member is signed in here.')).toBeVisible();
  const draft = page.getByRole('form', { name: 'Job draft_card' });
  await expect(draft.getByText('Approved: card 22222222 waits out the cooling window, then is dealt to now.')).toBeVisible();
  await expect(draft.getByText('Gatherers cost 11 (config, Builder A, $0.50): The gatherer costs one more to build. Graded approved: fits_pillars.')).toBeVisible();
  await draft.getByLabel('Reason').fill('Short of cards');
  await draft.getByRole('button', { name: 'Draft a game card' }).click();
  await expect(draft.getByText('Queued. It runs while a board member is signed in here.')).toBeVisible();
  expect(bodies).toContainEqual({ path: '/rest/v1/rpc/enqueue_manual_job', body: { p_job: 'studio_ranking', p_card: null, p_reason: 'New cards on now', p_input: {} } });
  expect(bodies).toContainEqual({ path: '/rest/v1/rpc/enqueue_manual_job', body: { p_job: 'draft_card', p_card: null, p_reason: 'Short of cards', p_input: {} } });
  await expect(page.getByRole('form', { name: 'Set the cooling window' }).getByLabel('Cooling window (minutes)')).toHaveValue('0');

  // The cards read carried the board member's session, never the anon key alone.
  expect(seen).toContain('GET /rest/v1/cards');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(reports).toEqual([]);
});
