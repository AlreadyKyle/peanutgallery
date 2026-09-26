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

/** A verified authenticator app, for a session at aal2. */
const TOTP_FACTOR = { id: 'f-verified', factor_type: 'totp', status: 'verified', friendly_name: '', created_at: '2026-09-14T00:00:00Z', updated_at: '2026-09-14T00:00:00Z' };

/**
 * A stored session for a board member, the way supabase-js keeps one after the magic link (aal1), or
 * after its second factor too (aal2).
 */
async function signIn(page: Page, aal: 'aal1' | 'aal2' = 'aal1') {
  const now = Math.floor(Date.now() / 1000);
  const amr = aal === 'aal2' ? [{ method: 'totp', timestamp: now }, { method: 'otp', timestamp: now }] : [{ method: 'otp', timestamp: now }];
  const payload = { sub: 'u-board', email: EMAIL, role: 'authenticated', aal, amr, exp: now + 3600, session_id: 's-1' };
  const session = {
    access_token: `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(payload)}.c2lnbmF0dXJl`,
    refresh_token: 'e2e-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user: { id: 'u-board', aud: 'authenticated', email: EMAIL, app_metadata: {}, user_metadata: {}, created_at: '2026-09-14T00:00:00Z', factors: aal === 'aal2' ? [TOTP_FACTOR] : [] },
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
  // A ceiling pause the resume rule will not resume: the card is PAUSED below.
  rule_blocked: [{ id: 'c0000000-0000-4000-8000-000000000005', title: 'Paused at the maximum', why: 'card_max', actual_usd: '25.0000', card_max_usd: '25.0000' }],
  // A card holding money whose approval is not current: the card is HIDDEN below.
  approval_void: [{ id: 'c0000000-0000-4000-8000-000000000006', title: 'Rewritten outside a board control', stage: 'proposed', money_usd: '2.0000' }],
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

// A board card on now with no money, which a veto moves to next, and one paused at its ceiling at the
// card maximum, which Needs you lists.
const ON_NOW = {
  ...UNDEALT,
  id: 'c0000000-0000-4000-8000-000000000004',
  title: 'Bigger pockets for the gatherers',
  horizon: 'now',
  rank: null,
  source: 'board',
  drafter_role_id: null,
  opens_at: null,
};
const PAUSED = {
  ...ON_NOW,
  id: 'c0000000-0000-4000-8000-000000000005',
  title: 'Paused at the maximum',
  stage: 'paused',
  funded_usd: '3.0000',
};

// An agent card with no current approval that holds money: card_is_public answers false for it, so
// only the board's session reads it, marked Hidden, and Needs you lists it.
const HIDDEN = {
  ...UNDEALT,
  id: 'c0000000-0000-4000-8000-000000000006',
  title: 'Rewritten outside a board control',
  horizon: 'now',
  rank: null,
  funded_usd: '2.0000',
  opens_at: null,
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
        // The first move names a card listed under Cards, the second one that is not.
        output: {
          moves: [
            { card_id: 'c0000000-0000-4000-8000-000000000004', from: null, to: 1 },
            { card_id: '11111111-1111-4111-8111-111111111111', from: 4, to: 2 },
          ],
          unapplied: 0,
        },
      },
    ],
  },
];

// card_supply (docs/specs/studio-reports.md), production's shape on 23 September 2026 (PG-10): six
// open goal cards, all under $2 and none of $5 or more, so the supply is short of its one big card.
const SUPPLY_CARDS = Array.from({ length: 6 }, (_, i) => ({ id: `d0000000-0000-4000-8000-00000000000${i}`, title: `Open card ${i}`, target_usd: '1.0000' }));
const SUPPLY = {
  open: 6,
  big: 0,
  small: 6,
  floor_open: 6,
  floor_big: 1,
  floor_small: 1,
  big_min_usd: '5.0000',
  small_max_usd: '2.0000',
  short_open: 0,
  short_big: 1,
  short_small: 0,
  open_cards: SUPPLY_CARDS,
};

// A small SVG, as Supabase Auth returns it before supabase-js turns it into a data: URL.
const QR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="black"/></svg>';

// The roles public_roles offers as a card's executor.
const PUBLIC_ROLES = [{ id: 'r-builder-a', title: 'Builder A', write_access: true, state: 'active' }];
const cards = [
  { id: 'c-e2e', title: 'An e2e card', stage: 'proposed', horizon: 'now', rank: 1, folder: 'seed-1', lane: 'config', funding_target_usd: 5, funded_usd: 2, estimate_usd: 3, created_at: '2026-09-20T00:00:00Z' },
];

async function answerSupabase(
  page: Page,
  seen: string[],
  { role = 'board', aal2 = false, bodies = [] }: { role?: 'board' | 'moderator'; aal2?: boolean; bodies?: Record<string, unknown>[] } = {},
) {
  let roles = ROLES.map((r) => ({ ...r }));
  let boardCards: (Record<string, unknown> & { id: string; horizon: string })[] = [...cards, ON_NOW, PAUSED, UNDEALT, HIDDEN].map((c) => ({ ...c }));
  await page.route(`${SUPABASE_URL}/**`, async (route: Route) => {
    const url = new URL(route.request().url());
    seen.push(`${route.request().method()} ${url.pathname}`);
    const body = route.request().postData();
    if (body) bodies.push({ path: url.pathname, body: JSON.parse(body) });
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    switch (url.pathname) {
      case '/auth/v1/user':
        return json({ id: 'u-board', aud: 'authenticated', email: EMAIL, app_metadata: {}, user_metadata: {}, created_at: '2026-09-14T00:00:00Z', factors: aal2 ? [TOTP_FACTOR] : [] });
      case '/auth/v1/factors':
        return json({ id: 'f-e2e', type: 'totp', friendly_name: '', totp: { qr_code: QR_SVG, secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/e2e' } });
      case '/rest/v1/rpc/board_role':
        return json(role);
      case '/rest/v1/rpc/set_paused':
        return route.fulfill({ status: 204, body: '' });
      case '/rest/v1/rpc/board_heartbeat':
        return json(new Date().toISOString());
      case '/rest/v1/rpc/board_studio_state':
        return json(studio);
      case '/rest/v1/rpc/board_needs_you':
        return json(needsYou);
      case '/rest/v1/rpc/card_supply':
        return json(SUPPLY);
      case '/rest/v1/rpc/board_roles':
        return json(roles);
      case '/rest/v1/rpc/set_role_pause': {
        // The role changes as the database changes it, so board_roles reads it back changed.
        const change = JSON.parse(body ?? '{}') as { p_role: string; p_paused: boolean; p_reason: string };
        roles = roles.map((r) => (r.id === change.p_role ? { ...r, paused: change.p_paused, paused_reason: change.p_paused ? change.p_reason : null } : r));
        return json(null);
      }
      case '/rest/v1/rpc/board_jobs':
        return json(JOBS);
      case '/rest/v1/rpc/card_is_public':
        return json((JSON.parse(body ?? '{}') as { p_card?: string }).p_card !== HIDDEN.id);
      case '/rest/v1/rpc/enqueue_manual_job':
        return json('run-queued-e2e');
      case '/rest/v1/rpc/set_card_veto': {
        // The card changes as the database changes it: a veto moves a card on now with no money to next.
        const change = JSON.parse(body ?? '{}') as { p_card: string; p_vetoed: boolean; p_reason: string };
        boardCards = boardCards.map((c) =>
          c.id === change.p_card
            ? { ...c, board_vetoed: change.p_vetoed, board_veto_reason: change.p_vetoed ? change.p_reason : null, horizon: change.p_vetoed && c.horizon === 'now' ? 'next' : c.horizon }
            : c,
        );
        const changed = boardCards.find((c) => c.id === change.p_card)!;
        return json({ card_id: changed.id, board_vetoed: changed.board_vetoed, horizon: changed.horizon, opens_at: changed.opens_at ?? null });
      }
      case '/rest/v1/public_roles':
        return json(PUBLIC_ROLES);
      case '/rest/v1/cards': {
        // Only the board member's own token reads the undealt card, as cards_board_read allows.
        const bearer = route.request().headers()['authorization'] ?? '';
        return json(bearer.includes('.') && bearer.split('.').length === 3 ? boardCards : []);
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
  // Cards is shown only at the second factor, so the ceiling pause names the second factor and links nowhere.
  await expect(inbox.getByText('verify your second factor, then resume it with a new estimate, or cancel it, under Cards.', { exact: false })).toBeVisible();
  await expect(inbox.locator('a[href^="#"]')).toHaveCount(0);
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

test('at the second factor the board sees and vetoes an undealt agent card, pauses a role from the keyboard, and reads the jobs and the cooling window, under the enforced policy', async ({ page }) => {
  const reports = await watchPolicy(page);
  const seen: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  await answerSupabase(page, seen, { aal2: true, bodies });
  await signIn(page, 'aal2');
  await page.goto('/');

  // Needs you's ceiling pause links to the card's row under Cards, which is on the page.
  const toCard = page.getByRole('region', { name: 'Needs you' }).getByRole('link', { name: 'resume it with a new estimate, or cancel it, under Cards' });
  await expect(toCard).toHaveAttribute('href', `#card-${PAUSED.id}`);
  await toCard.click();
  await expect(page.locator(`#card-${PAUSED.id}`)).toBeInViewport();
  // The void card holding money links to its row, where it is marked hidden and can be vetoed or cancelled.
  const needs = page.getByRole('region', { name: 'Needs you' });
  await expect(needs.getByText(`Card ${HIDDEN.title} holds $2.00 but its approval is not current.`)).toBeVisible();
  await expect(needs.getByRole('link', { name: 'Cancel it under Cards' })).toHaveAttribute('href', `#card-${HIDDEN.id}`);
  const hidden = page.getByRole('form', { name: `Card ${HIDDEN.title}` });
  await expect(hidden.getByText(/^Hidden: written by an agent with no current approval/)).toBeVisible();
  await expect(hidden.getByRole('button', { name: 'Cancel card' })).toBeVisible();

  // A keyboard user vetoes a card on now: the veto moves it to next, and the confirmation is shown and
  // focus stays on the one veto button, which now reads Lift veto.
  const onNow = page.getByRole('form', { name: `Card ${ON_NOW.title}` });
  await onNow.getByLabel('Reason').focus();
  await page.keyboard.type('Off pillar');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(onNow.getByRole('button', { name: 'Veto card' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(onNow.getByRole('status')).toHaveText('Card vetoed.');
  await expect(onNow.getByText(/ · horizon next · /)).toBeVisible();
  await expect(onNow.getByRole('button', { name: 'Lift veto' })).toBeFocused();
  expect(bodies).toContainEqual({ path: '/rest/v1/rpc/set_card_veto', body: { p_card: ON_NOW.id, p_vetoed: true, p_reason: 'Off pillar' } });

  const card = page.getByRole('form', { name: `Card ${UNDEALT.title}` });
  await expect(card).toBeVisible();
  await expect(card.getByText('Written by an agent; its approval is current.')).toBeVisible();
  await expect(card.getByText(/^Waiting to be dealt: moves to now at /)).toBeVisible();
  await card.getByLabel('Reason').fill('Not this week');
  await card.getByRole('button', { name: 'Veto card' }).click();
  await expect(card.getByRole('status')).toHaveText('Card vetoed.');
  await expect(card.getByRole('button', { name: 'Lift veto' })).toBeFocused();
  expect(bodies).toContainEqual({ path: '/rest/v1/rpc/set_card_veto', body: { p_card: UNDEALT.id, p_vetoed: true, p_reason: 'Not this week' } });

  const roles = page.getByRole('region', { name: 'Roles' });
  await expect(roles.getByRole('row', { name: 'Game Director reviewer not paused' })).toBeVisible();
  await expect(roles.getByRole('row', { name: 'QA writer paused: Checking the gate' })).toBeVisible();
  // A keyboard user pauses a role through the one form; the confirmation is announced and focus stays on the button.
  await roles.getByRole('combobox').selectOption({ label: 'Game Director' });
  await roles.getByRole('textbox', { name: 'Reason' }).focus();
  await page.keyboard.type('Too many loops');
  await page.keyboard.press('Tab');
  await expect(roles.getByRole('button', { name: 'Pause Game Director' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(roles.getByRole('status')).toHaveText('Game Director paused.');
  await expect(roles.getByRole('row', { name: 'Game Director reviewer paused: Too many loops' })).toBeVisible();
  await expect(roles.getByRole('button', { name: 'Resume Game Director' })).toBeFocused();
  expect(bodies).toContainEqual({ path: '/rest/v1/rpc/set_role_pause', body: { p_role: 'r-director', p_paused: true, p_reason: 'Too many loops' } });
  const jobs = page.getByRole('region', { name: 'Jobs' });
  await expect(jobs.getByText('scheduled · skipped: its role is paused', { exact: false })).toBeVisible();
  await expect(jobs.getByRole('button', { name: 'Run now' })).toBeVisible();
  // Rank now and Draft a game card queue board-origin runs with {}, and each run shows its typed output.
  const rank = page.getByRole('form', { name: 'Job studio_ranking' });
  // Each moved card on its own line: by title, linked to its row under Cards, or by short id when not listed.
  await expect(rank.locator('ol.job-runs > li')).toHaveText(['Bigger pockets for the gatherers: from no rank to rank 1', 'card 11111111: from rank 4 to rank 2']);
  await expect(rank.getByRole('link', { name: 'Bigger pockets for the gatherers' })).toHaveAttribute('href', '#card-c0000000-0000-4000-8000-000000000004');
  await rank.getByLabel('Reason').fill('New cards on now');
  await rank.getByRole('button', { name: 'Rank now' }).click();
  await expect(rank.getByText('Queued. It runs while a board member is signed in here.')).toBeVisible();
  const draft = page.getByRole('form', { name: 'Job draft_card' });
  await expect(draft.getByText('Approved: Gatherers cost 11 waits out the cooling window, then is dealt to now.')).toBeVisible();
  await expect(draft.getByText('Gatherers cost 11 (config, Builder A, $0.50): The gatherer costs one more to build. Approved: fits pillars.')).toBeVisible();
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

/**
 * Each pair of stacked controls placed straight in a section, and what follows them, with the space
 * between them: the forms' rhythm is 16 px. A subheading sits 8 px over its list by design.
 */
async function sectionGaps(page: Page): Promise<{ where: string; gap: number }[]> {
  return page.locator('main section').evaluateAll((sections) =>
    sections.flatMap((section) => {
      const shown = [...section.children].filter((el) => el.getBoundingClientRect().height > 0);
      return shown.slice(1).flatMap((next, i) => {
        const before = shown[i]!;
        const gap = next.getBoundingClientRect().top - before.getBoundingClientRect().bottom;
        if (gap < -1 || before.tagName === 'H3') return [];
        const name = (el: Element) => `${el.tagName.toLowerCase()}${el.className ? `.${el.className}` : ''}`;
        return [{ where: `${section.getAttribute('aria-label')}: ${name(before)} then ${name(next)}`, gap: Math.round(gap * 100) / 100 }];
      });
    }),
  );
}

for (const [who, role, aal] of [
  ['a moderator', 'moderator', 'aal1'],
  ['a board member at aal2', 'board', 'aal2'],
] as const) {
  test(`the page keeps 16 px between stacked controls for ${who}, and the focused pause reason clears the buttons, at 375, 768 and 1440 px`, async ({ page }) => {
    const reports = await watchPolicy(page);
    const seen: string[] = [];
    await answerSupabase(page, seen, { role, aal2: aal === 'aal2' });
    await signIn(page, aal);
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      if (role === 'board') await expect(page.getByText('An e2e card').first()).toBeVisible();
      await page.getByRole('button', { name: 'Pause agents' }).click();
      await expect(page.getByRole('region', { name: 'Pause and resume' }).getByRole('status')).toHaveText('Agents paused.');
      const tight = (await sectionGaps(page)).filter(({ gap }) => gap < 15.5);
      expect(tight, `${width} px`).toEqual([]);
      // BOARD_E2E_SHOTS=<folder> keeps a full-page screenshot of each width to look at.
      if (process.env.BOARD_E2E_SHOTS) await page.screenshot({ path: `${process.env.BOARD_E2E_SHOTS}/${role}-${width}.png`, fullPage: true });

      // Reached from the keyboard, the select shows its focus ring, which must end above the buttons.
      await page.getByLabel('Pause reason').focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      const ring = await page.getByLabel('Pause reason').evaluate((select) => {
        const style = getComputedStyle(select);
        const row = select.closest('label')!.nextElementSibling!;
        return {
          visible: select.matches(':focus-visible'),
          clearance: row.getBoundingClientRect().top - (select.getBoundingClientRect().bottom + parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth)),
        };
      });
      expect(ring.visible, `${width} px`).toBe(true);
      expect(ring.clearance, `${width} px`).toBeGreaterThanOrEqual(8);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), `${width} px`).toBe(false);
    }
    expect(seen).toContain('POST /rest/v1/rpc/set_paused');
    expect(reports).toEqual([]);
  });
}

// docs/specs/studio-reports.md: the card supply floor on /board.
test('the card supply: the line, Card supply is short, and Draft to the floor queues one draft_card run at the second factor alone, under the enforced policy', async ({ page }) => {
  const reports = await watchPolicy(page);
  const seen: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  await answerSupabase(page, seen, { aal2: true, bodies });
  await signIn(page, 'aal2');
  await page.goto('/');

  await expect(page.getByRole('region', { name: 'Studio status' }).getByText('Open cards: 6 of a floor of 6 · $5 or more: 0 of 1 · under $2: 6 of 1.')).toBeVisible();
  const needs = page.getByRole('region', { name: 'Needs you' });
  await expect(needs.getByText('Card supply is short.')).toBeVisible();
  const floor = page.getByRole('form', { name: 'Draft to the floor' });
  await floor.getByLabel('Reason').fill('No big card open');
  await floor.getByRole('button', { name: 'Draft to the floor' }).click();
  await expect(needs.getByText(/^Queued\. The Game Designer drafts while a board member is signed in here/)).toBeVisible();
  const queued = bodies.filter((b) => b.path === '/rest/v1/rpc/enqueue_manual_job');
  expect(queued).toEqual([
    {
      path: '/rest/v1/rpc/enqueue_manual_job',
      body: { p_job: 'draft_card', p_card: null, p_reason: 'No big card open', p_input: { floor: { short_open: 0, short_big: 1, short_small: 0 }, open_cards: SUPPLY_CARDS.map((c) => c.id) } },
    },
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  expect(reports).toEqual([]);
});

test('at the first factor the supply item asks for the second factor and offers no Draft to the floor', async ({ page }) => {
  const reports = await watchPolicy(page);
  const seen: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  await answerSupabase(page, seen, { bodies });
  await signIn(page);
  await page.goto('/');
  const needs = page.getByRole('region', { name: 'Needs you' });
  await expect(needs.getByText('Card supply is short.')).toBeVisible();
  await expect(needs.getByText('Verify your second factor, then draft to the floor from here.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Draft to the floor' })).toHaveCount(0);
  expect(bodies.filter((b) => b.path === '/rest/v1/rpc/enqueue_manual_job')).toEqual([]);
  expect(reports).toEqual([]);
});
