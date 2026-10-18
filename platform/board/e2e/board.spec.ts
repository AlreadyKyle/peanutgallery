import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { SUPABASE_URL } from './fixture-env';

// vite preview sends netlify.toml's headers (vite.config.ts), so every page here loads under the
// board's enforced Content Security Policy. Any report fails the test. Supabase is never reached:
// every request to the project is answered here.
const toml = readFileSync(fileURLToPath(new URL('../netlify.toml', import.meta.url)), 'utf8');
const enforced = toml.match(/^\s*Content-Security-Policy\s*=\s*"([^"]*)"/m)?.[1] ?? '';
const host = new URL(SUPABASE_URL).host;
const storageKey = `sb-${host.split('.')[0]}-auth-token`;
const EMAIL = 'board@mobmachine.games';

// The calls the old page made that this panel never makes (docs/specs/optional-board.md). set_role_pause
// left the list: the final state's Agents admin turns a role on and off (docs/specs/final-state.md, Admin).
const RETIRED = ['board_heartbeat', 'board_needs_you', 'board_roles', 'card_is_public', 'set_card_veto', 'set_caps'];

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

const STUDIO = {
  paused: true,
  paused_by: EMAIL,
  paused_at: '2026-10-09T00:00:00Z',
  dispatcher_seen_at: null,
  daily_cap_usd: 100,
  card_max_usd: 25,
  agent_hourly_rate_usd: 5,
  monthly_cap_usd: 500,
  credit_studio_daily_cap_usd: 500,
  anthropic_tier_cap_usd: null,
  platform_lane_open: false,
};

const CARD = { id: 'c0000000-0000-4000-8000-000000000001', title: 'An e2e card', stage: 'funded', horizon: 'now', failing_check: 'tests', updated_at: '2026-10-09T10:00:00Z', estimate_usd: '3.0000', created_at: '2026-10-01T00:00:00Z' };
const PAUSED = { ...CARD, id: 'c0000000-0000-4000-8000-000000000002', title: 'Paused at its ceiling', stage: 'paused', failing_check: null, estimate_usd: '0.5000', updated_at: '2026-10-09T09:00:00Z' };
const OPEN = { ...CARD, id: 'c0000000-0000-4000-8000-000000000003', title: 'Quiet rooms', stage: 'proposed', horizon: 'next', failing_check: null, updated_at: '2026-10-09T08:00:00Z' };

const JOBS = [
  { name: 'tidy_up', role_name: null, calls_model: false, runs_when_paused: true, description: null, runs: [{ id: 'run-e2e', origin: 'schedule', status: 'skipped', reason: 'role_paused', created_at: '2026-10-09T10:00:00Z' }] },
  { name: 'weekly_report', role_name: 'Studio Head', calls_model: true, runs_when_paused: true, description: null, runs: [] },
];

const SUPPLY = { open: 6, big: 0, small: 6, floor_open: 6, floor_big: 1, floor_small: 1, big_min_usd: '5.0000', small_max_usd: '2.0000', short_open: 0, short_big: 1, short_small: 0, open_cards: [] };

const FINDINGS = [
  {
    fingerprint: 'scan:links',
    kind: 'scan',
    subject: "The weekly scan's links job failed (failure)",
    detail: { run: 'https://github.com/AlreadyKyle/peanutgallery/actions/runs/12', conclusion: 'failure' },
    opened_at: '2026-10-08T11:30:00Z',
    last_seen_at: '2026-10-09T08:00:00Z',
  },
];

// One queued suggestion, with the Curator's triage, as board_suggestions gives it (docs/specs/community-core.md).
const SUGGESTION = {
  id: 's0000000-0000-4000-8000-000000000001', area: 'dust', title: 'Night mode', body: 'The sand could glow at night.', state: 'clustered', declineReason: null, held: false,
  votes: 4, createdAt: '2026-10-09T10:00:00Z', author: 'supporter-1', clusterId: 'k0000000-0000-4000-8000-000000000001', clusterKey: 'night-mode', cardId: null,
  triage: { kind: 'feature', fit: 0.8, flags: [], summary: 'Glowing sand at night.', clusterKey: 'night-mode' }, cursor: '1|s',
};

// board_games and board_agent_roster as 20261017220000_board_games_admin.sql answers them.
const GAMES = [
  {
    folder: 'seed-1', name: 'Dust', status: 'live', accepting_cards: true, featured: true, blurb: 'An idle game you play in a browser.',
    play_url: 'https://play.mobmachine.games', box_art: '/games/dust-box-art.svg',
    plays: { load_event: 'dust_load', share_event: 'dust_share', loads: { day: 40, week: 40, month: 40, total: 40 }, shares: { day: 6, week: 6, month: 6, total: 6 } },
    admin_log: [{ at: '2026-10-09T09:00:00Z', actor: EMAIL, action: 'feature_game', reason: 'Our first game', details: { from: false, to: true, unfeatured: null } }],
    open_count: 1, shipped_count: 1,
    open_cards: [{ id: CARD.id, title: 'An e2e card', stage: 'funded', horizon: 'now', updated_at: '2026-10-09T10:00:00Z' }],
    shipped_cards: [{ id: 'c-live', title: 'Night sky', live_at: '2026-10-08T10:00:00Z', commit_sha: 'abc1234' }],
    latest_deploy: { sha: 'abc1234ffff', is_green: true, smoke_result: 'ok', created_at: '2026-10-09T11:00:00Z' },
    latest_green_deploy: { sha: 'abc1234ffff', created_at: '2026-10-09T11:00:00Z' },
  },
];
const AGENTS = [
  {
    id: 'r-builder-a', name: 'Builder A', title: 'Builder A', model: 'claude-e2e', tools: ['Read', 'Edit', 'Bash', 'Glob', 'Grep', 'Write'], write_access: true, agent_class: 'builder',
    description: 'Builds funded game cards in the paths each card allows.', species_note: 'A badger with a hard hat.', avatar_url: null, trigger: null, budget_share: 0.125,
    state: 'active', status: 'running', paused: false, paused_reason: null, paused_at: null, jobs: ['build_card'],
    spend: { day_usd: 1.5, week_usd: 4, month_usd: 12.25, total_usd: 40 },
    caps: { role_day_usd: 1.5, role_month_usd: 12.25, studio_day_usd: 3, studio_month_usd: 50, daily_cap_usd: 100, monthly_cap_usd: 500 },
    runs_day: { succeeded: 3, failed: 1, skipped: 0, queued: 0, running: 0 },
    runs_week: { succeeded: 9, failed: 2, skipped: 0, last_at: '2026-10-09T11:00:00Z' },
    recent_runs: [{ id: 'run-1', job: 'build_card', status: 'failed', origin: 'schedule', card_id: null, reason: 'tests', created_at: '2026-10-09T11:00:00Z', started_at: null, finished_at: null }],
    pause_history: [{ at: '2026-10-08T07:00:00Z', actor: EMAIL, paused: true, reason: 'Flaky test' }],
  },
  {
    id: 'r-host', name: 'Host', title: 'Host', model: 'claude-e2e-small', tools: [], write_access: false, agent_class: 'web_only',
    description: 'Narrates the stream.', species_note: null, avatar_url: null, trigger: 'When the stream exists.', budget_share: 0,
    state: 'active', status: 'planned', paused: false, paused_reason: null, paused_at: null, jobs: [],
    spend: { day_usd: 0, week_usd: 0, month_usd: 0, total_usd: 0 },
    caps: { role_day_usd: 0, role_month_usd: 0, studio_day_usd: 3, studio_month_usd: 50, daily_cap_usd: 100, monthly_cap_usd: 500 },
    runs_day: { succeeded: 0, failed: 0, skipped: 0, queued: 0, running: 0 },
    runs_week: { succeeded: 0, failed: 0, skipped: 0, last_at: null },
    recent_runs: [],
    pause_history: [],
  },
];

const EVENTS = [{ id: 'e1', card_id: CARD.id, type: 'message', created_at: '2026-10-09T09:30:00Z', step: 'dealt', line_key: 'card_dealt' }];

// A small SVG, as Supabase Auth returns it before supabase-js turns it into a data: URL.
const QR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="black"/></svg>';

async function answerSupabase(
  page: Page,
  seen: string[],
  { role = 'board', aal2 = false, bodies = [] }: { role?: 'board' | 'moderator'; aal2?: boolean; bodies?: Record<string, unknown>[] } = {},
) {
  // The cards change as the database changes them, so the next read gives them back changed.
  let cards = [CARD, PAUSED, OPEN].map((c) => ({ ...c }));
  await page.route(`${SUPABASE_URL}/**`, async (route: Route) => {
    const url = new URL(route.request().url());
    seen.push(`${route.request().method()} ${url.pathname}${url.pathname.startsWith('/rest/v1/rpc/') ? '' : url.search}`);
    const body = route.request().postData();
    const args = body ? (JSON.parse(body) as Record<string, unknown>) : {};
    if (body) bodies.push({ path: url.pathname, body: args });
    const json = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    switch (url.pathname) {
      case '/auth/v1/user':
        return json({ id: 'u-board', aud: 'authenticated', email: EMAIL, app_metadata: {}, user_metadata: {}, created_at: '2026-09-14T00:00:00Z', factors: aal2 ? [TOTP_FACTOR] : [] });
      case '/auth/v1/factors':
        return json({ id: 'f-e2e', type: 'totp', friendly_name: '', totp: { qr_code: QR_SVG, secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/e2e' } });
      case '/rest/v1/rpc/board_role':
        return json(role);
      case '/rest/v1/rpc/set_paused':
        return route.fulfill({ status: 204, body: '' });
      case '/rest/v1/rpc/board_studio_state':
        return json(STUDIO);
      case '/rest/v1/public_studio':
        return json([{ pause_reason: 'incident' }]);
      case '/rest/v1/rpc/card_supply':
        return json(SUPPLY);
      case '/rest/v1/rpc/board_jobs':
        return json(JOBS);
      case '/rest/v1/rpc/board_play_counts':
        return json([
          { day: '2026-10-11', dust_load: 40, dust_share: 6, card_share: 2, dust_next_card: 3 },
          { day: '2026-10-10', dust_load: 0, dust_share: 0, card_share: 0, dust_next_card: 0 },
        ]);
      case '/rest/v1/findings':
        return json(FINDINGS);
      case '/rest/v1/public_agent_events':
        return json(url.searchParams.get('card_id') === `eq.${CARD.id}` ? EVENTS : []);
      case '/rest/v1/public_roles':
        return json([{ id: 'r-builder-a', title: 'Builder A', write_access: true, state: 'active' }]);
      case '/rest/v1/cards': {
        const stages = url.searchParams.get('stage');
        return json(stages === null ? cards : cards.filter((c) => stages.includes(c.stage)));
      }
      case '/rest/v1/rpc/cancel_card':
        cards = cards.map((c) => (c.id === args.p_card ? { ...c, stage: 'rejected' } : c));
        return json({ card_id: args.p_card, stage: 'rejected', moved_usd: 1.8 });
      case '/rest/v1/rpc/resume_card':
        cards = cards.map((c) => (c.id === args.p_card ? { ...c, stage: 'funded' } : c));
        return json(null);
      case '/rest/v1/rpc/file_card':
        return json('1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d');
      case '/rest/v1/rpc/record_credit_purchase':
        return json(null);
      case '/rest/v1/rpc/enqueue_manual_job':
        return json('run-queued-e2e');
      case '/rest/v1/rpc/board_suggestions':
        return json({ items: [SUGGESTION], next: null });
      case '/rest/v1/rpc/board_decline_suggestion':
        return json({ id: args.p_id, state: 'declined' });
      case '/rest/v1/rpc/board_community_cards':
        return json({ items: [{ id: CARD.id, title: 'An e2e card', stage: 'funded', suit: 'game', rarity: 'common', computedRarity: 'rare' }], next: null });
      case '/rest/v1/rpc/board_games':
        return json(GAMES);
      case '/rest/v1/rpc/board_agent_roster':
        return json(AGENTS);
      case '/rest/v1/rpc/set_role_pause':
        return json({ role: args.p_role, paused: args.p_paused });
      case '/rest/v1/rpc/board_set_game_status':
        return json({ folder: args.p_folder, status: args.p_status });
      case '/rest/v1/rpc/board_set_game_accepting':
        return json({ folder: args.p_folder, accepting_cards: args.p_accepting });
      case '/rest/v1/rpc/board_set_game_featured':
        return json({ folder: args.p_folder, featured: args.p_featured, unfeatured: null });
      case '/rest/v1/rpc/board_set_game_blurb':
        return json({ folder: args.p_folder, blurb: args.p_blurb === '' ? null : args.p_blurb });
      case '/rest/v1/rpc/board_flags':
        return json({ curator_triage: false, profiles_open: true });
      default:
        return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"not in the e2e fixtures"}' });
    }
  });
}

const overflows = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

/**
 * The space between the bottom of a focused control's ring and the top of the line under it, and
 * whether the ring shows (it does only when the control was reached from the keyboard).
 */
async function ringClearance(control: Locator, below: Locator): Promise<{ visible: boolean; clearance: number }> {
  const under = (await below.boundingBox())!;
  return control.evaluate(
    (el, top) => {
      const style = getComputedStyle(el);
      return {
        visible: el.matches(':focus-visible'),
        clearance: Math.round((top - (el.getBoundingClientRect().bottom + parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth))) * 100) / 100,
      };
    },
    under.y,
  );
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
  await expect(page.getByRole('heading', { level: 1, name: 'Mob Machine board' })).toBeVisible();
  await expect(page.getByText('an optional admin panel; the studio runs without it', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Board email')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toBeVisible();
  expect(await overflows(page)).toBe(false);
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

test('at the first factor a board member sees only the code step, sets up an authenticator app, and the page reads nothing of the studio', async ({ page }) => {
  const reports = await watchPolicy(page);
  const seen: string[] = [];
  await answerSupabase(page, seen);
  await signIn(page);
  await page.goto('/');

  const twoFactor = page.getByRole('region', { name: 'Two-factor sign-in' });
  await expect(twoFactor).toBeVisible();
  expect(await page.locator('main section').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))).toEqual(['Two-factor sign-in']);
  await expect(page.getByRole('button', { name: 'Pause agents' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Set up an authenticator app' }).click();
  // The QR code is a data: image, which the policy's img-src allows.
  const qr = page.getByRole('img', { name: 'QR code for your authenticator app' });
  await expect(qr).toBeVisible();
  expect(await qr.evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0)).toBe(true);
  expect(await qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml;utf-8,<svg /);

  // A code the fixtures refuse: the status line under the Verify form clears the focused button's ring.
  await twoFactor.getByLabel('6-digit code').fill('123456');
  await page.keyboard.press('Tab');
  const verify = twoFactor.getByRole('button', { name: 'Verify' });
  await expect(verify).toBeFocused();
  await page.keyboard.press('Enter');
  const status = twoFactor.getByRole('status');
  await expect(status).not.toHaveText('');
  const ring = await ringClearance(verify, status);
  expect(ring.visible).toBe(true);
  expect(ring.clearance).toBeGreaterThanOrEqual(8);
  expect(await overflows(page)).toBe(false);

  expect(seen).toContain('POST /auth/v1/factors');
  const rest = seen.filter((line) => line.includes('/rest/v1/'));
  expect(rest).toEqual(rest.filter((line) => line === 'POST /rest/v1/rpc/board_role'));
  expect(reports).toEqual([]);
});

test('at the second factor the panel shows Status, Activity and Actions, and every action sends its contract body, under the enforced policy', async ({ page }) => {
  const reports = await watchPolicy(page);
  const seen: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  await answerSupabase(page, seen, { aal2: true, bodies });
  await signIn(page, 'aal2');
  await page.goto('/');

  // Status first: paused with its reason, the dispatcher, the caps read-only, the supply line.
  const status = page.getByRole('region', { name: 'Status' });
  await expect(status.getByText('Agents: paused. Reason: A problem we are checking.')).toBeVisible();
  await expect(status.getByText('Dispatcher: not running.')).toBeVisible();
  await expect(status.getByText('Daily cap $100.00. Card maximum $25.00.', { exact: false })).toBeVisible();
  await expect(status.getByText('The caps are read-only here: they change by SQL.')).toBeVisible();
  await expect(status.getByText('Open cards: 6 of a floor of 6 · $5 or more: 0 of 1 · under $2: 6 of 1.')).toBeVisible();
  const sections = await page.locator('main > section').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')));
  // community-core adds Community last, and board-live Games and agents before it (docs/specs/final-state.md).
  expect(sections).toEqual(['Status', 'Activity', 'Play and share counts', 'Actions', 'Games and agents', 'Community']);

  // Play and share counts (docs/specs/play-counts.md): one row a day and the total, read once for 14 days.
  const counts = page.getByRole('region', { name: 'Play and share counts' });
  await expect(counts.locator('tr[data-day="2026-10-11"] > *')).toHaveText(['2026-10-11', '40', '6', '2', '3']);
  await expect(counts.locator('tr[data-day="total"] > *')).toHaveText(['Total', '40', '6', '2', '3']);
  expect(bodies).toContainEqual({ path: '/rest/v1/rpc/board_play_counts', body: { p_days: 14 } });

  // Activity: a recent card with its failing check, a run line, the findings link and one card's events.
  const activity = page.getByRole('region', { name: 'Activity' });
  await expect(activity.locator(`li[data-card="${CARD.id}"]`)).toContainText('An e2e card · funded · now · failing check: tests');
  await expect(activity.getByText('tidy_up · scheduled · skipped: its role is paused', { exact: false })).toBeVisible();
  await expect(activity.getByRole('link', { name: FINDINGS[0]!.detail.run })).toHaveAttribute('href', FINDINGS[0]!.detail.run);
  const events = page.getByRole('form', { name: 'Card events' });
  await events.getByLabel('Card').selectOption({ label: CARD.title });
  await events.getByRole('button', { name: 'Show events' }).click();
  await expect(events.locator('ol li')).toHaveText([/ · message · step dealt · card_dealt$/]);
  expect(seen).toContainEqual(expect.stringMatching(new RegExp(`^GET /rest/v1/public_agent_events\\?.*card_id=eq\\.${CARD.id}`)));

  // Reject from the keyboard: the confirm is accepted, the money moved is said, focus stays on the button.
  const cardActions = page.getByRole('form', { name: 'Card actions' });
  await cardActions.getByLabel('Card').selectOption({ label: `${CARD.title} (funded)` });
  await cardActions.getByLabel('Reason').fill('Out of scope');
  await cardActions.getByLabel('Reason').focus();
  await page.keyboard.press('Tab');
  const reject = cardActions.getByRole('button', { name: 'Reject card' });
  await expect(reject).toBeFocused();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.keyboard.press('Enter');
  const actionStatus = cardActions.getByRole('status');
  await expect(actionStatus).toHaveText('Card An e2e card rejected. $1.80 of unspent money moved to the next cards in line.');
  await expect(reject).toBeFocused();
  const ring = await ringClearance(reject, actionStatus);
  expect(ring.visible).toBe(true);
  expect(ring.clearance).toBeGreaterThanOrEqual(8);
  expect(bodies).toContainEqual({ path: '/rest/v1/rpc/cancel_card', body: { p_card: CARD.id, p_reason: 'Out of scope' } });

  // Resume a paused card with a new estimate.
  await cardActions.getByLabel('Card').selectOption({ label: `${PAUSED.title} (paused)` });
  await expect(cardActions.getByLabel('New estimate (USD)')).toHaveValue('0.5');
  await cardActions.getByLabel('New estimate (USD)').fill('0.8');
  await cardActions.getByLabel('Reason').fill('Credit topped up');
  await cardActions.getByRole('button', { name: 'Resume card' }).click();
  await expect(actionStatus).toHaveText('Card Paused at its ceiling resumed.');
  expect(bodies).toContainEqual({ path: '/rest/v1/rpc/resume_card', body: { p_card: PAUSED.id, p_estimate_usd: 0.8, p_reason: 'Credit topped up' } });

  // File a card: always proposed, with its horizon.
  const file = page.getByRole('form', { name: 'File a card' });
  await file.getByLabel('Title').fill('A second level');
  await file.getByLabel('Public summary').fill('Somewhere new to play.');
  await file.getByLabel('Intent (for the agents)').fill('Add a stage.');
  await file.getByLabel('Acceptance test').fill('check: it loads');
  await file.getByLabel('Funding target (USD)').fill('4');
  await file.getByRole('button', { name: 'File card' }).click();
  await expect(file.getByRole('status')).toHaveText('Card filed as card 1a2b3c4d.');
  expect(bodies).toContainEqual({
    path: '/rest/v1/rpc/file_card',
    body: {
      p_bucket: 'game',
      p_lane: 'config',
      p_folder: 'seed-1',
      p_title: 'A second level',
      p_summary: 'Somewhere new to play.',
      p_intent: 'Add a stage.',
      p_acceptance_test: 'check: it loads',
      p_funding_target_usd: 4,
      p_stage: 'proposed',
      p_executor_role_id: 'r-builder-a',
      p_board_reason: '',
      p_horizon: 'now',
    },
  });

  // Run a job now: input {} and no card.
  const run = page.getByRole('form', { name: 'Run a job now' });
  await run.getByLabel('Job').selectOption('weekly_report');
  await run.getByLabel('Reason').fill('Debugging');
  await run.getByRole('button', { name: 'Run now' }).click();
  await expect(run.getByRole('status')).toHaveText('Queued weekly_report. It runs on the next dispatcher tick.');
  expect(bodies).toContainEqual({ path: '/rest/v1/rpc/enqueue_manual_job', body: { p_job: 'weekly_report', p_card: null, p_reason: 'Debugging', p_input: {} } });

  expect(await overflows(page)).toBe(false);
  for (const name of RETIRED) expect(seen).not.toContain(`POST /rest/v1/rpc/${name}`);
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
      else await expect(page.locator('main section')).toHaveCount(1);
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
      expect(await overflows(page), `${width} px`).toBe(false);
    }
    expect(seen).toContain('POST /rest/v1/rpc/set_paused');
    if (role === 'moderator') expect(seen.filter((line) => line.includes('/rest/v1/'))).toEqual(seen.filter((line) => /rpc\/(board_role|set_paused)$/.test(line)));
    for (const name of RETIRED) expect(seen).not.toContain(`POST /rest/v1/rpc/${name}`);
    expect(reports).toEqual([]);
  });
}

test('the Community admin reads nothing until a tab is chosen, and declines a suggestion with its reason after the confirm, at 375 px', async ({ page }) => {
  const reports = await watchPolicy(page);
  const seen: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  await answerSupabase(page, seen, { aal2: true, bodies });
  await signIn(page, 'aal2');
  await page.goto('/');
  const community = page.getByRole('region', { name: 'Community' });
  await expect(community.getByRole('button', { name: 'Suggestions' })).toBeVisible();
  expect(seen.filter((line) => /rpc\/board_(suggestions|flags|community_users|seeds|moderation_log)$/.test(line))).toEqual([]);
  await community.getByRole('button', { name: 'Suggestions' }).click();
  const row = community.locator(`tr[data-suggestion="${SUGGESTION.id}"]`);
  await expect(row).toContainText('Night mode');
  await expect(row).toContainText('Glowing sand at night.');
  await expect(row.getByRole('button', { name: 'Decline' })).toBeDisabled();
  await expect(community.getByText(/^Type a reason first/)).toBeVisible();
  // Every action sits inside the column, stacked, at a phone's width and a desktop's: the table never
  // runs past its box.
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const box = (await community.boundingBox())!;
    for (const name of ['Decline', 'Draft from cluster', 'Link card', 'Merge into']) {
      const button = (await row.getByRole('button', { name }).boundingBox())!;
      expect(button.x + button.width, `${name} at ${width} px`).toBeLessThanOrEqual(box.x + box.width + 1);
    }
    expect(await community.locator('.table-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth), `${width} px`).toBe(true);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  // Merge and link pick from what is loaded; no field takes a typed id.
  await expect(row.getByLabel('Card to link cluster night-mode to')).toContainText('An e2e card (funded)');
  await expect(row.getByRole('textbox')).toHaveCount(0);
  await community.getByLabel('Decline as').selectOption('duplicate');
  await community.getByLabel(/^Reason for changes/).fill('Same as an open card');
  const asked: string[] = [];
  page.once('dialog', (dialog) => {
    asked.push(dialog.message());
    void dialog.accept();
  });
  await row.getByRole('button', { name: 'Decline' }).click();
  await expect(community.getByRole('status')).toHaveText('Decline: done.');
  expect(asked).toEqual(['Decline the suggestion "Night mode" as duplicate? It leaves the queue, and Release does not bring a declined suggestion back.']);
  expect(bodies).toContainEqual({ path: '/rest/v1/rpc/board_decline_suggestion', body: { p_id: SUGGESTION.id, p_decline_reason: 'duplicate', p_reason: 'Same as an open card' } });
  await community.getByRole('button', { name: 'Flags' }).click();
  await expect(community.locator('tr[data-flag="curator_triage"]')).toContainText('false');
  expect(await overflows(page)).toBe(false);
  expect(reports).toEqual([]);
});

test('Games and agents reads nothing until a tab is chosen, shows the box art under the policy, and turns a role off with its reason, at 375 px', async ({ page }) => {
  const reports = await watchPolicy(page);
  const seen: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  await answerSupabase(page, seen, { aal2: true, bodies });
  await signIn(page, 'aal2');
  await page.goto('/');
  const roster = page.getByRole('region', { name: 'Games and agents' });
  await expect(roster.getByRole('button', { name: 'Games' })).toBeVisible();
  expect(seen.filter((line) => /rpc\/board_(games|agent_roster)$/.test(line))).toEqual([]);
  await roster.getByRole('button', { name: 'Games' }).click();
  const tile = roster.locator('li[data-game="seed-1"]');
  await expect(tile).toContainText('Dust');
  await expect(tile).toContainText('status: live');
  const art = tile.getByRole('img', { name: 'Dust box art' });
  await expect(art).toBeVisible();
  expect(await art.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await roster.getByRole('button', { name: 'Agents' }).click();
  const agent = roster.locator('li[data-role="Builder A"]');
  await expect(agent).toContainText('claude-e2e');
  await expect(agent).toContainText('$12.25 in 30 days');
  await expect(agent).toContainText("$1.50 of the studio's $3.00 today, 2% of the daily cap of $100.00");
  await expect(agent).toContainText('Builds funded game cards in the paths each card allows.');
  await expect(roster.locator('[data-group="planned"] li[data-role="Host"]')).toContainText('Planned (When the stream exists.)');
  if (process.env.BOARD_E2E_SHOTS) await roster.screenshot({ path: `${process.env.BOARD_E2E_SHOTS}/agents-375.png` });
  await roster.getByLabel('Reason for turning a role on or off').fill('Too many failed builds');
  await agent.getByRole('button', { name: 'Turn Builder A off' }).click();
  await expect(roster.getByRole('status')).toHaveText('Builder A turned off.');
  expect(bodies).toContainEqual({ path: '/rest/v1/rpc/set_role_pause', body: { p_role: 'r-builder-a', p_paused: true, p_reason: 'Too many failed builds' } });
  expect(await overflows(page)).toBe(false);
  expect(reports).toEqual([]);
});

test('Games changes a game only with a reason, each write sending its contract body, at 375 px under the policy', async ({ page }) => {
  const reports = await watchPolicy(page);
  const seen: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  await answerSupabase(page, seen, { aal2: true, bodies });
  await signIn(page, 'aal2');
  await page.goto('/');
  const roster = page.getByRole('region', { name: 'Games and agents' });
  await roster.getByRole('button', { name: 'Games' }).click();
  const tile = roster.locator('li[data-game="seed-1"]');
  await expect(tile).toContainText('Featured');
  await expect(tile).toContainText('Loads40 today');
  await tile.getByText('Manage Dust').click();
  // No reason yet: the buttons are marked and nothing is sent.
  await expect(tile.getByRole('button', { name: 'Stop new cards' })).toHaveAttribute('aria-disabled', 'true');
  await tile.getByRole('button', { name: 'Stop new cards' }).click({ force: true });
  expect(seen.filter((line) => /rpc\/board_set_game/.test(line))).toEqual([]);
  await roster.getByLabel('Reason for changes to a game (written to the moderation log)').fill('A crash on load');
  await tile.getByLabel('Status').selectOption('paused');
  await tile.getByRole('button', { name: 'Set status' }).click();
  await expect(roster.getByRole('status')).toHaveText('Dust is paused.');
  await tile.getByRole('button', { name: 'Stop new cards' }).click();
  await expect(roster.getByRole('status')).toHaveText('Dust takes no new cards.');
  await tile.getByRole('button', { name: 'Unfeature' }).click();
  await expect(roster.getByRole('status')).toHaveText('Dust is no longer featured.');
  await tile.getByLabel(/^Public blurb/).fill('A quarry idle game, free to play.');
  await tile.getByRole('button', { name: 'Save blurb' }).click();
  await expect(roster.getByRole('status')).toHaveText("Dust's blurb saved.");
  expect(bodies.filter((b) => String(b.path).includes('board_set_game'))).toEqual([
    { path: '/rest/v1/rpc/board_set_game_status', body: { p_folder: 'seed-1', p_status: 'paused', p_reason: 'A crash on load' } },
    { path: '/rest/v1/rpc/board_set_game_accepting', body: { p_folder: 'seed-1', p_accepting: false, p_reason: 'A crash on load' } },
    { path: '/rest/v1/rpc/board_set_game_featured', body: { p_folder: 'seed-1', p_featured: false, p_reason: 'A crash on load' } },
    { path: '/rest/v1/rpc/board_set_game_blurb', body: { p_folder: 'seed-1', p_blurb: 'A quarry idle game, free to play.', p_reason: 'A crash on load' } },
  ]);
  await tile.getByText('Recent changes').click();
  await expect(tile).toContainText('featured: Our first game');
  // BOARD_E2E_SHOTS=<folder> keeps a screenshot of the managed tile to look at.
  if (process.env.BOARD_E2E_SHOTS) await roster.screenshot({ path: `${process.env.BOARD_E2E_SHOTS}/games-375.png` });
  expect(await overflows(page)).toBe(false);
  expect(reports).toEqual([]);
});

for (const motion of ['reduce', 'no-preference'] as const) {
  test(`the board's motion with prefers-reduced-motion: ${motion}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: motion });
    const seen: string[] = [];
    await answerSupabase(page, seen, { aal2: true });
    await signIn(page, 'aal2');
    await page.goto('/');
    const roster = page.getByRole('region', { name: 'Games and agents' });
    const games = roster.getByRole('button', { name: 'Games' });
    await expect(games).toBeVisible();
    const transition = await games.evaluate((el) => getComputedStyle(el).transitionProperty);
    await games.click();
    await expect(roster.locator('li[data-game="seed-1"]')).toBeVisible();
    const tile = roster.locator('li[data-game="seed-1"]');
    await tile.hover();
    if (motion === 'reduce') {
      // Everything is drawn still: no transition, no animation, no lift.
      expect(transition).toBe('all');
      expect(await games.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
      expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
      expect(await tile.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    } else {
      expect(transition).toBe('transform');
      await expect.poll(() => tile.evaluate((el) => getComputedStyle(el).transform)).toBe('matrix(1, 0, 0, 1, 0, -2)');
    }
  });
}
