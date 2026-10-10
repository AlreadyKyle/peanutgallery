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

// The calls the old page made that this panel never makes (docs/specs/optional-board.md).
const RETIRED = ['board_heartbeat', 'board_needs_you', 'board_roles', 'card_is_public', 'set_role_pause', 'set_card_veto', 'set_caps'];

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
  expect(sections).toEqual(['Status', 'Activity', 'Actions']);

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
