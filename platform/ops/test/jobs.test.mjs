// Tests for the VPS jobs (docs/specs/money-safety.md): the env rules, the read-only Stripe reader, the
// Controller's reconciliation and credit formula against a made-up Stripe account
// (fixtures/stripe-account.json), the quota check, and each job end to end with fake HTTP. Nothing
// here reaches Stripe, GitHub, Supabase or ntfy. ops.test.mjs imports this file, so `pnpm test:ops`
// runs it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { alertMessage, OPERATIONS_BUCKET_USD, readStripe, reconcile, runController, webhookEventTypes } from '../jobs/controller.mjs';
import { envFileProblems } from '../jobs/check-env.mjs';
import { JOB_KEYS, jobEnvProblems, stripeApiVersion, stripeReader, supabaseClient } from '../jobs/lib.mjs';
import { main } from '../jobs/main.mjs';
import { actionsMinutes, evaluateQuota, runQuota } from '../jobs/quota.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ACCOUNT = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'stripe-account.json'), 'utf8'));
const NOW = new Date(ACCOUNT.now);
const clone = (value) => JSON.parse(JSON.stringify(value));
const AGE_RECIPIENT = `age1${'q'.repeat(58)}`;

const CONTROLLER_ENV = {
  SUPABASE_URL: 'https://fixture.supabase.local',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fixture',
  STRIPE_READ_KEY: 'rk_live_fixture',
  NTFY_TOPIC_URL: 'https://ntfy.sh/fixture-topic',
  CONTROLLER_HEALTHCHECK_URL: 'https://hc-ping.com/fixture-controller',
};
const QUOTA_ENV = {
  SUPABASE_URL: 'https://fixture.supabase.local',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-legacy-service-role',
  GITHUB_BILLING_TOKEN: 'github_pat_fixture',
  GITHUB_BILLING_USER: 'AlreadyKyle',
  NTFY_TOPIC_URL: 'https://ntfy.sh/fixture-topic',
};
const BACKUP_ENV = {
  BACKUP_DB_URL: 'postgresql://peanutgallery_backup.fixtureref:fixture-password@aws-0-ca-central-1.pooler.supabase.com:5432/postgres',
  BACKUP_AGE_RECIPIENT: AGE_RECIPIENT,
  BACKUP_PAR_URL: 'https://objectstorage.ca-toronto-1.oraclecloud.com/p/fixture-par/n/fixturens/b/peanutgallery-backups/o/',
  BACKUP_BUCKET: 'peanutgallery-backups',
  BACKUP_HEALTHCHECK_URL: 'https://hc-ping.com/fixture-backup',
};

// The account as the Controller's readStripe returns it.
function stripeData(account = ACCOUNT) {
  return {
    sessions: account.sessions,
    charges: account.charges,
    disputes: account.disputes,
    payouts: account.payouts,
    payoutTransactions: account.payout_transactions,
    undelivered: account.undelivered_events,
    balance: account.balance,
    truncated: [],
  };
}

const failing = (result) => result.checks.filter((c) => !c.ok).map((c) => c.name);

// A fetch stand-in answering Stripe, Supabase, GitHub, ntfy and healthchecks from the fixture, and
// recording every request.
function fakeFetch(account = ACCOUNT, overrides = {}) {
  const calls = [];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const list = (data) => json(200, { object: 'list', data, has_more: false });
  const fetchFn = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    calls.push({ method, url: url.toString(), headers: init.headers ?? {}, body: init.body ?? null });
    const override = overrides[`${method} ${url.origin}${url.pathname}`];
    if (override) return override(url, init);
    if (url.origin === 'https://api.stripe.com') {
      const route = url.pathname.replace('/v1/', '');
      if (route === 'checkout/sessions') return list(account.sessions);
      if (route === 'charges') return list(account.charges);
      if (route === 'disputes') return list(account.disputes);
      if (route === 'payouts') return list(account.payouts);
      if (route === 'events') return list(account.undelivered_events);
      if (route === 'balance') return json(200, account.balance);
      if (route === 'balance_transactions') return list(account.payout_transactions[url.searchParams.get('payout')] ?? []);
      return json(404, { error: { message: `no fixture for ${route}` } });
    }
    if (url.pathname === '/rest/v1/rpc/ledger_identity') return json(200, account.identity);
    if (url.pathname === '/rest/v1/rpc/controller_figures') return json(200, account.figures);
    if (url.pathname === '/rest/v1/rpc/record_dispute_reinstated') return json(200, { found: true, inserted: true, reinstated_usd: 10 });
    if (url.pathname === '/rest/v1/rpc/ops_database_size') return json(200, 52428800);
    if (url.pathname === '/rest/v1/controller_runs') return new Response(null, { status: 201 });
    if (url.origin === 'https://api.github.com') return json(200, { usageItems: [{ product: 'actions', sku: 'Actions Linux', unitType: 'Minutes', quantity: 812 }] });
    return new Response('ok', { status: 200 });
  };
  return { fetchFn, calls };
}

const sink = () => {
  const lines = [];
  return { lines, write: (text) => lines.push(text) };
};

describe('job env rules', () => {
  test('accept each job env and refuse a Stripe secret key under any name', () => {
    assert.deepEqual(jobEnvProblems('controller', CONTROLLER_ENV), []);
    assert.deepEqual(jobEnvProblems('quota', QUOTA_ENV), []);
    assert.deepEqual(jobEnvProblems('backup', BACKUP_ENV), []);
    for (const [job, env] of [
      ['controller', CONTROLLER_ENV],
      ['quota', QUOTA_ENV],
      ['backup', BACKUP_ENV],
    ]) {
      for (const secret of ['sk_live_fixture', 'sk_test_fixture']) {
        const problems = jobEnvProblems(job, { ...env, SOMETHING_ELSE: secret });
        assert.ok(problems.includes('SOMETHING_ELSE holds a Stripe secret key; no job may hold one, under any name'), `${job} ${secret}`);
        assert.ok(!problems.join('\n').includes(secret), 'names keys only');
      }
    }
  });

  test('take only a restricted live key as STRIPE_READ_KEY', () => {
    for (const key of ['rk_test_fixture', 'pk_live_fixture', 'fixture']) {
      assert.ok(jobEnvProblems('controller', { ...CONTROLLER_ENV, STRIPE_READ_KEY: key }).includes('STRIPE_READ_KEY must be a restricted live key (rk_live_...)'), key);
    }
    assert.ok(jobEnvProblems('controller', { ...CONTROLLER_ENV, STRIPE_READ_KEY: 'sk_live_fixture' }).includes('STRIPE_READ_KEY holds a Stripe secret key; no job may hold one, under any name'));
    assert.throws(() => stripeReader({ key: 'sk_live_fixture', version: 'v' }), /takes only a restricted live key/);
  });

  test('hold the backup to the read-only login, one age key and a write-only request for its bucket', () => {
    const cases = [
      [{ BACKUP_DB_URL: BACKUP_ENV.BACKUP_DB_URL.replace('peanutgallery_backup.', 'postgres.') }, 'BACKUP_DB_URL must be the Session pooler (port 5432) as peanutgallery_backup.<project ref>'],
      [{ BACKUP_DB_URL: BACKUP_ENV.BACKUP_DB_URL.replace(':5432/', ':6543/') }, 'BACKUP_DB_URL must be the Session pooler'],
      [{ BACKUP_AGE_RECIPIENT: 'AGE-SECRET-KEY-1FIXTURE' }, 'BACKUP_AGE_RECIPIENT must be one age public key'],
      [{ BACKUP_BUCKET: 'another-bucket' }, 'BACKUP_PAR_URL names another bucket than BACKUP_BUCKET'],
      [{ BACKUP_PAR_URL: 'https://objectstorage.ca-toronto-1.oraclecloud.com/n/fixturens/b/peanutgallery-backups/o/' }, 'must be an Object Storage pre-authenticated request'],
      [{ BACKUP_HEALTHCHECK_URL: 'http://hc-ping.com/fixture-backup' }, 'BACKUP_HEALTHCHECK_URL must be an https URL'],
      [{ RESTORE_CHECK_WEEKDAY: '8' }, 'RESTORE_CHECK_WEEKDAY must be 1 (Monday) to 7 (Sunday)'],
      [{ BACKUP_SKIP_AUTH: 'true' }, 'BACKUP_SKIP_AUTH must be 1 or absent'],
    ];
    for (const [change, message] of cases) {
      const problems = jobEnvProblems('backup', { ...BACKUP_ENV, ...change });
      assert.ok(problems.some((problem) => problem.includes(message)), `${message}: ${problems.join('; ')}`);
    }
    assert.deepEqual(jobEnvProblems('backup', { ...BACKUP_ENV, BACKUP_SKIP_AUTH: '1' }), []);
    assert.ok(!JOB_KEYS.backup.required.concat(JOB_KEYS.backup.optional).some((key) => /OWNER/.test(key)), 'no job key holds the owner');
  });

  // The owner can drop the append-only triggers, so its password reaches no job, whatever the key.
  test("refuse the database owner's login under any name, pooled or direct, in every job", () => {
    const owners = [
      BACKUP_ENV.BACKUP_DB_URL.replace('peanutgallery_backup.', 'postgres.'),
      'postgres://postgres:fixture-owner@db.fixtureref.supabase.co:5432/postgres',
      'postgresql://postgres@db.fixtureref.supabase.co:5432/postgres',
    ];
    for (const [job, env] of [
      ['controller', CONTROLLER_ENV],
      ['quota', QUOTA_ENV],
      ['backup', BACKUP_ENV],
    ]) {
      for (const owner of owners) {
        const problems = jobEnvProblems(job, { ...env, ANY_NAME: owner });
        assert.ok(problems.includes("ANY_NAME signs in as the database owner; no job may hold the owner's password, under any name"), `${job} ${owner}`);
        assert.ok(!problems.join('\n').includes('fixture-owner'), 'names keys only');
      }
    }
    const asBackup = jobEnvProblems('backup', { ...BACKUP_ENV, BACKUP_DB_URL: owners[0] });
    assert.ok(asBackup.includes("BACKUP_DB_URL signs in as the database owner; no job may hold the owner's password, under any name"));
  });

  test("check-env refuses another job's key, a quote, a duplicate and a line that is not KEY=value", () => {
    const text = (env) => `${Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
    assert.deepEqual(envFileProblems('controller', text(CONTROLLER_ENV)), []);
    const cases = [
      [`${text(CONTROLLER_ENV)}GITHUB_BILLING_TOKEN=github_pat_fixture\n`, 'GITHUB_BILLING_TOKEN is not a controller key'],
      [`${text(CONTROLLER_ENV)}STRIPE_SECRET_KEY=fixture\n`, 'STRIPE_SECRET_KEY is not a controller key'],
      [text({ ...CONTROLLER_ENV, NTFY_TOPIC_URL: '"https://ntfy.sh/fixture-topic"' }), 'NTFY_TOPIC_URL starts with a quote'],
      [`${text(CONTROLLER_ENV)}NTFY_TOPIC_URL=https://ntfy.sh/other\n`, 'NTFY_TOPIC_URL is set more than once'],
      [`export ${text(CONTROLLER_ENV)}`, 'line 1 is not KEY=value'],
    ];
    for (const [file, message] of cases) {
      const problems = envFileProblems('controller', file);
      assert.ok(problems.some((problem) => problem.includes(message)), `${message}: ${problems.join('; ')}`);
      assert.ok(!problems.join('\n').includes('rk_live_fixture'), 'names keys only');
    }
  });
});

describe('the Stripe reader', () => {
  test('sends GET requests only, with the restricted key and the pinned API version, and pages to the end', async () => {
    const pages = [
      { object: 'list', data: [{ id: 'a' }, { id: 'b' }], has_more: true },
      { object: 'list', data: [{ id: 'c' }], has_more: false },
    ];
    const calls = [];
    const fetchFn = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(pages[calls.length - 1]), { status: 200 });
    };
    const stripe = stripeReader({ key: 'rk_live_fixture', fetchFn, version: stripeApiVersion() });
    const result = await stripe.list('charges', { 'expand[]': 'data.balance_transaction' });
    assert.deepEqual(result, { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], truncated: false });
    assert.equal(calls[1].url, 'https://api.stripe.com/v1/charges?expand%5B%5D=data.balance_transaction&limit=100&starting_after=b');
    for (const call of calls) {
      assert.equal(call.init.method, 'GET');
      assert.equal(call.init.headers.Authorization, 'Bearer rk_live_fixture');
      assert.equal(call.init.headers['Stripe-Version'], /STRIPE_API_VERSION = "([^"]+)"/.exec(readFileSync(path.join(HERE, '..', '..', 'supabase', 'functions', '_shared', 'stripe_api_version.ts'), 'utf8'))[1]);
      assert.equal(call.init.body, undefined);
    }
    const capped = stripeReader({ key: 'rk_live_fixture', fetchFn: async () => new Response(JSON.stringify({ data: [{ id: 'x' }], has_more: true })), version: 'v', maxPages: 2 });
    assert.equal((await capped.list('charges')).truncated, true);
  });

  test('reads every list the Controller needs, the payout transactions per payout, and the undelivered webhook events of the last 30 days', async () => {
    const { fetchFn, calls } = fakeFetch();
    const stripe = stripeReader({ key: 'rk_live_fixture', fetchFn, version: 'v' });
    const data = await readStripe(stripe, NOW);
    assert.equal(data.sessions.length, 3);
    assert.deepEqual(Object.keys(data.payoutTransactions), ['po_fixture_1']);
    const events = calls.find((call) => call.url.includes('/v1/events'));
    const url = new URL(events.url);
    assert.equal(url.searchParams.get('delivery_success'), 'false');
    assert.deepEqual(url.searchParams.getAll('types[]'), webhookEventTypes());
    assert.equal(Number(url.searchParams.get('created[gte]')), NOW.getTime() / 1000 - 30 * 86_400);
    assert.deepEqual(webhookEventTypes(), ['checkout.session.completed', 'charge.updated', 'charge.refunded', 'charge.dispute.created', 'charge.dispute.funds_withdrawn']);
  });

  test('sends a new-format Supabase secret key in apikey only and a legacy key as the bearer too', async () => {
    const seen = [];
    const fetchFn = async (url, init) => {
      seen.push(init.headers);
      return new Response('{}', { status: 200 });
    };
    await supabaseClient({ url: 'https://fixture.supabase.local/', key: 'sb_secret_fixture', fetchFn }).rpc('ledger_identity');
    await supabaseClient({ url: 'https://fixture.supabase.local', key: 'legacy-fixture', fetchFn }).rpc('ledger_identity');
    assert.equal(seen[0].apikey, 'sb_secret_fixture');
    assert.equal(seen[0].Authorization, undefined);
    assert.equal(seen[1].Authorization, 'Bearer legacy-fixture');
  });
});

describe('the Controller reconciliation', () => {
  test('passes the account whose books match, and computes the credit purchase and the Minimum balance', () => {
    const result = reconcile({ identity: ACCOUNT.identity, figures: ACCOUNT.figures, stripe: stripeData(), now: NOW });
    assert.deepEqual(failing(result), []);
    assert.equal(result.ok, true);
    // need = ceilings 7.50 + operations 0 + overhead since the purchase 0.05 - credit left (5 - 3.30) = 5.85;
    // cap = paid-out agent money 8.1906 + overhead 0.20 - bought 5 = 3.3906; the purchase is the smaller.
    assert.equal(OPERATIONS_BUCKET_USD, 0);
    assert.deepEqual(result.figures.credit_purchase, {
      remaining_ceilings_usd: 7.5,
      funded_cards: 2,
      operations_bucket_usd: 0,
      overhead_since_last_purchase_usd: 0.05,
      credit_left_usd: 1.7,
      need_usd: 5.85,
      paid_out_agent_money_usd: 8.1906,
      overhead_usd: 0.2,
      bought_usd: 5,
      cap_usd: 3.3906,
    });
    assert.equal(result.figures.credit_purchase_usd, 3.39);
    // reserve 1.20 + held 0 + the last 30 days' fees (0.81 and 0.52 CAD at 1.37) = 2.17 USD, 2.98 CAD.
    assert.equal(result.figures.minimum_balance_usd, 2.17);
    assert.deepEqual(result.figures.minimum_balance, {
      reserve_usd: 1.2,
      held_usd: 0,
      recent_fees_usd: 0.9708,
      fee_window_days: 30,
      settlement_currency: 'cad',
      settlement_rate: 1.37,
      settlement_amount: 2.98,
    });
  });

  test('names the newest paid payout for the board to record the credit purchase against, or none before the first', () => {
    const result = reconcile({ identity: ACCOUNT.identity, figures: ACCOUNT.figures, stripe: stripeData(), now: NOW });
    assert.deepEqual(result.figures.latest_payout, { id: 'po_fixture_1', arrival_date: '2026-09-25', amount: 16.48, currency: 'cad' });
    const two = clone(ACCOUNT);
    two.payouts = [{ ...two.payouts[0], id: 'po_newer', arrival_date: two.payouts[0].arrival_date + 86400, amount: 500 }, ...two.payouts];
    two.payout_transactions.po_newer = [];
    assert.equal(reconcile({ identity: ACCOUNT.identity, figures: ACCOUNT.figures, stripe: stripeData(two), now: NOW }).figures.latest_payout.id, 'po_newer');
    const unpaid = clone(ACCOUNT);
    unpaid.payouts = [];
    assert.equal(reconcile({ identity: ACCOUNT.identity, figures: ACCOUNT.figures, stripe: stripeData(unpaid), now: NOW }).figures.latest_payout, null);
  });

  test('buys what funded cards need when that is less than the paid-out agent money, and never less than nothing', () => {
    const figures = clone(ACCOUNT.figures);
    figures.funded_cards.remaining_ceilings_usd = 2;
    assert.equal(reconcile({ identity: ACCOUNT.identity, figures, stripe: stripeData(), now: NOW }).figures.credit_purchase_usd, 0.35);
    figures.funded_cards.remaining_ceilings_usd = 0;
    assert.equal(reconcile({ identity: ACCOUNT.identity, figures, stripe: stripeData(), now: NOW }).figures.credit_purchase_usd, 0);
    // Nothing paid out yet: no purchase, whatever the cards need.
    const unpaid = clone(ACCOUNT);
    unpaid.payouts = [];
    assert.equal(reconcile({ identity: ACCOUNT.identity, figures: ACCOUNT.figures, stripe: stripeData(unpaid), now: NOW }).figures.credit_purchase_usd, 0);
  });

  test('counts only agent money: a hold or the incident share on a paid-out payment never raises the cap', () => {
    const figures = clone(ACCOUNT.figures);
    figures.families[0].agent_money_usd = 1;
    const result = reconcile({ identity: ACCOUNT.identity, figures, stripe: stripeData(), now: NOW });
    assert.equal(result.figures.credit_purchase.paid_out_agent_money_usd, 2.755);
    assert.equal(result.figures.credit_purchase_usd, 0);
  });

  test('names a paid session with no payment row as a missed webhook, and a payment row Stripe does not show', () => {
    const account = clone(ACCOUNT);
    account.figures.families = [account.figures.families[1], { ...account.figures.families[1], payment_id: 'pay-ghost', session_id: 'cs_ghost' }];
    const result = reconcile({ identity: account.identity, figures: account.figures, stripe: stripeData(account), now: NOW });
    assert.deepEqual(failing(result), ['payments_credited', 'payments_known']);
    assert.deepEqual(result.checks.find((c) => c.name === 'payments_credited').items, [
      {
        session: 'cs_fixture_a',
        amount_usd: 10,
        paid_on: '2026-09-20',
        fix: 'the webhook missed this payment: resend its checkout.session.completed event from the Stripe Dashboard (Developers, Events) while it is under 30 days old, or the board credits it by hand',
      },
    ]);
    assert.deepEqual(result.checks.find((c) => c.name === 'payments_known').items, [{ payment: 'pay-ghost', session: 'cs_ghost', amount_usd: 5 }]);
  });

  test('pairs a payment made before session ids were recorded by amount and day', () => {
    const account = clone(ACCOUNT);
    account.figures.families[0].session_id = null;
    assert.deepEqual(failing(reconcile({ identity: account.identity, figures: account.figures, stripe: stripeData(account), now: NOW })), []);
  });

  test('names a net that differs from the amount less the fee, and a refund the books miss', () => {
    const account = clone(ACCOUNT);
    account.figures.families[0].net_usd = 9.5;
    account.charges[1].amount_refunded = 300;
    const result = reconcile({ identity: account.identity, figures: account.figures, stripe: stripeData(account), now: NOW });
    assert.deepEqual(failing(result), ['payment_amounts', 'refunds_booked', 'stripe_costs_booked']);
    assert.deepEqual(result.checks.find((c) => c.name === 'payment_amounts').items, [{ session: 'cs_fixture_a', books_net_usd: 9.5, stripe_net_usd: 9.4088 }]);
    assert.equal(result.checks.find((c) => c.name === 'refunds_booked').items[0].stripe_refunded_usd, 3);
  });

  test('asks for an adjustment when Stripe kept a fee the books do not carry', () => {
    const account = clone(ACCOUNT);
    account.figures.families[1].books_net_usd = 2.7722;
    account.figures.families[1].adjusted_net_usd = 0;
    const result = reconcile({ identity: account.identity, figures: account.figures, stripe: stripeData(account), now: NOW });
    assert.deepEqual(failing(result), ['stripe_costs_booked']);
    assert.deepEqual(result.checks.find((c) => c.name === 'stripe_costs_booked').items, [
      {
        session: 'cs_fixture_b',
        payment: 'pay-fixture-b',
        books_net_usd: 2.7722,
        stripe_net_usd: 2.6204,
        fix: 'Stripe kept $0.1518 the books do not carry: record an adjustment of net -0.1518, studio -0.1518 on this payment at /board',
      },
    ]);
  });

  test('puts back a dispute Stripe closed as won, names the dispute fee, and names a dispute the books missed', () => {
    const account = clone(ACCOUNT);
    account.disputes = [
      {
        id: 'dp_fixture_won',
        object: 'dispute',
        amount: 1000,
        currency: 'usd',
        charge: 'ch_fixture_a',
        payment_intent: 'pi_fixture_a',
        status: 'won',
        evidence_details: { due_by: 1790294400 },
        balance_transactions: [
          { id: 'txn_fixture_dispute', object: 'balance_transaction', type: 'adjustment', amount: -1370, fee: 2055, net: -3425, currency: 'cad', exchange_rate: 1.37 },
          { id: 'txn_fixture_reinstated', object: 'balance_transaction', type: 'adjustment', amount: 1370, fee: 0, net: 1370, currency: 'cad', exchange_rate: 1.37 },
        ],
      },
    ];
    Object.assign(account.figures.families[0], { disputed_usd: 10, books_net_usd: 0 });
    const result = reconcile({ identity: account.identity, figures: account.figures, stripe: stripeData(account), now: NOW });
    assert.deepEqual(result.reinstate, [{ dispute_id: 'dp_fixture_won', session_id: 'cs_fixture_a', amount_usd: 10 }]);
    // The payment being put back is compared on the next run, once its reinstated row is in the books.
    assert.deepEqual(failing(result), []);
    // Then the books carry 9.4088 again, and Stripe holds that less the 20.55 CAD dispute fee (15 USD).
    const after = clone(account);
    Object.assign(after.figures.families[0], { reinstated_usd: 10, books_net_usd: 9.4088 });
    const next = reconcile({ identity: after.identity, figures: after.figures, stripe: stripeData(after), now: NOW });
    assert.deepEqual(next.reinstate, []);
    const costs = next.checks.find((c) => c.name === 'stripe_costs_booked').items;
    assert.deepEqual(costs.map((item) => [item.books_net_usd, item.stripe_net_usd]), [[9.4088, -5.5912]]);
    assert.match(costs[0].fix, /record an adjustment of net -15\.0000, studio -15\.0000/);

    const missed = clone(account);
    missed.disputes[0].status = 'needs_response';
    missed.figures.families[0].disputed_usd = 0;
    const open = reconcile({ identity: missed.identity, figures: missed.figures, stripe: stripeData(missed), now: NOW });
    assert.equal(open.checks.find((c) => c.name === 'disputes_booked').items[0].dispute, 'dp_fixture_won');
    assert.deepEqual(open.attention, [{ dispute: 'dp_fixture_won', status: 'needs_response', due_by: '2026-09-25', amount_usd: 10 }]);
    assert.match(alertMessage(open), /Dispute dp_fixture_won \(needs_response, \$10\.00\) needs an answer in Stripe by 2026-09-25\./);
  });

  test('names a payout whose transactions do not sum to it, an undelivered event, spend beyond the credit, a low balance, a drifting ledger and a list read short', () => {
    const account = clone(ACCOUNT);
    account.payouts[0].amount = 1700;
    account.undelivered_events = [{ id: 'evt_fixture_lost', object: 'event', type: 'charge.refunded', created: 1790067600, pending_webhooks: 1 }];
    account.figures.credit.studio_spend_usd = 6;
    account.balance.available[0].amount = 100;
    account.identity = { holds: false, lines: [{ name: 'I1', drift: 0, holds: true }, { name: 'I2', drift: 0.25, holds: false }, { name: 'I3', drift: 0, holds: true }] };
    const data = stripeData(account);
    data.truncated = ['charges'];
    const result = reconcile({ identity: account.identity, figures: account.figures, stripe: data, now: NOW });
    assert.deepEqual(failing(result), ['ledger_identity', 'payouts_sum', 'webhook_delivered', 'console_credit', 'minimum_balance', 'stripe_lists_complete']);
    assert.equal(result.mismatches, 6);
    assert.deepEqual(result.checks.find((c) => c.name === 'payouts_sum').items, [{ payout: 'po_fixture_1', amount: 1700, transactions_sum: 1648, currency: 'cad' }]);
    assert.equal(result.checks.find((c) => c.name === 'webhook_delivered').items[0].fix, 'resend it from the Stripe Dashboard (Developers, Events)');
    const message = alertMessage(result);
    assert.match(message, /^Controller: 6 mismatch\(es\) between the books and Stripe\./);
    // The overspend raises what the cards need, but the purchase stays capped by paid-out agent money.
    assert.match(message, /Credit to buy now: \$3\.39\. Minimum balance: \$2\.17 USD \(2\.98 CAD\)\.$/);
  });
});

describe('the Controller run', () => {
  test('reads Stripe with GET only, writes one controller_runs row, and alerts nobody when everything matches', async () => {
    const { fetchFn, calls } = fakeFetch();
    const out = sink();
    const row = await runController({ env: CONTROLLER_ENV, fetchFn, now: NOW, out });
    assert.equal(row.ok, true);
    assert.match(out.lines[0], /^PASS: controller 0 mismatch\(es\); credit to buy \$3\.39; minimum balance \$2\.17\n$/);
    const stripeCalls = calls.filter((call) => call.url.startsWith('https://api.stripe.com/'));
    assert.ok(stripeCalls.length >= 7);
    for (const call of stripeCalls) {
      assert.equal(call.method, 'GET');
      assert.equal(call.headers.Authorization, 'Bearer rk_live_fixture');
    }
    const inserts = calls.filter((call) => call.url.endsWith('/rest/v1/controller_runs'));
    assert.equal(inserts.length, 1);
    assert.deepEqual(Object.keys(JSON.parse(inserts[0].body)).sort(), ['checks', 'figures', 'job', 'mismatches', 'ok', 'started_at']);
    assert.equal(JSON.parse(inserts[0].body).job, 'reconcile');
    assert.equal(calls.filter((call) => call.url.startsWith('https://ntfy.sh/')).length, 0);
    assert.deepEqual(calls.filter((call) => call.url.startsWith('https://hc-ping.com/')).map((call) => call.url), ['https://hc-ping.com/fixture-controller']);
  });

  test('reinstates a won dispute, alerts the board on a mismatch and pings the healthcheck /fail', async () => {
    const account = clone(ACCOUNT);
    account.disputes = [{ id: 'dp_fixture_won', object: 'dispute', amount: 1000, currency: 'usd', charge: 'ch_fixture_a', payment_intent: 'pi_fixture_a', status: 'won', balance_transactions: [] }];
    Object.assign(account.figures.families[0], { disputed_usd: 10, books_net_usd: 0 });
    account.undelivered_events = [{ id: 'evt_fixture_lost', object: 'event', type: 'charge.refunded', created: 1790067600 }];
    const { fetchFn, calls } = fakeFetch(account);
    const row = await runController({ env: CONTROLLER_ENV, fetchFn, now: NOW, out: sink() });
    assert.equal(row.ok, false);
    const reinstate = calls.find((call) => call.url.endsWith('/rpc/record_dispute_reinstated'));
    assert.deepEqual(JSON.parse(reinstate.body), { p_dispute_id: 'dp_fixture_won', p_stripe_session_id: 'cs_fixture_a', p_amount_usd: 10 });
    assert.deepEqual(row.figures.reinstated, [{ dispute_id: 'dp_fixture_won', session_id: 'cs_fixture_a', amount_usd: 10, done: true, reinstated_usd: 10 }]);
    const alert = calls.find((call) => call.url === 'https://ntfy.sh/fixture-topic');
    assert.match(alert.body, /webhook_delivered: \{"event":"evt_fixture_lost"/);
    assert.equal(alert.headers.Title, 'Peanut Gallery Controller');
    assert.ok(calls.some((call) => call.url === 'https://hc-ping.com/fixture-controller/fail'));
  });

  test('a dry run reads everything and writes, reinstates and alerts nothing', async () => {
    const account = clone(ACCOUNT);
    account.undelivered_events = [{ id: 'evt_fixture_lost', object: 'event', type: 'charge.refunded', created: 1790067600 }];
    const { fetchFn, calls } = fakeFetch(account);
    const out = sink();
    await runController({ env: CONTROLLER_ENV, fetchFn, now: NOW, dryRun: true, out });
    assert.match(out.lines[0], /\(dry run: nothing written, nobody alerted\)/);
    assert.deepEqual(calls.filter((call) => call.method !== 'GET' && !call.url.includes('/rest/v1/rpc/ledger_identity') && !call.url.includes('/rest/v1/rpc/controller_figures')), []);
  });

  test('refuses to start, making no request, with a Stripe secret key', async () => {
    const { fetchFn, calls } = fakeFetch();
    await assert.rejects(runController({ env: { ...CONTROLLER_ENV, STRIPE_READ_KEY: 'sk_live_fixture' }, fetchFn, now: NOW, out: sink() }), /STRIPE_READ_KEY holds a Stripe secret key/);
    assert.deepEqual(calls, []);
  });
});

describe('the quota check', () => {
  test('counts the Actions minutes of this month from the billing usage report', () => {
    assert.equal(
      actionsMinutes({
        usageItems: [
          { product: 'actions', unitType: 'Minutes', quantity: 500 },
          { product: 'Actions', unitType: 'minutes', quantity: 12 },
          { product: 'actions', unitType: 'GigabyteHours', quantity: 3 },
          { product: 'packages', unitType: 'Minutes', quantity: 99 },
        ],
      }),
      512,
    );
    assert.throws(() => actionsMinutes({ message: 'Not Found' }), /no usageItems/);
  });

  test('alerts at 350 MB and when fewer than 400 of the 2,000 minutes are left', () => {
    const settings = { DATABASE_ALERT_MB: 350, ACTIONS_MINUTES_INCLUDED: 2000, ACTIONS_MINUTES_FLOOR: 400 };
    assert.equal(evaluateQuota({ databaseBytes: 349 * 1024 * 1024, minutesUsed: 1600, settings }).ok, true);
    const full = evaluateQuota({ databaseBytes: 350 * 1024 * 1024, minutesUsed: 1601, settings });
    assert.deepEqual(failing(full), ['database_size', 'actions_minutes']);
    const unread = evaluateQuota({ databaseBytes: 1, minutesUsed: 0, minutesError: 'github billing usage: http 403', settings });
    assert.match(unread.checks[1].items[0].fix, /Plan read permission/);
  });

  test("reads this month's usage with the dispatcher token, writes a quota row and alerts on a limit", async () => {
    const { fetchFn, calls } = fakeFetch(ACCOUNT, {
      'POST https://fixture.supabase.local/rest/v1/rpc/ops_database_size': () => new Response(JSON.stringify(400 * 1024 * 1024), { status: 200 }),
    });
    const row = await runQuota({ env: QUOTA_ENV, fetchFn, now: NOW, out: sink() });
    const github = calls.find((call) => call.url.startsWith('https://api.github.com/'));
    assert.equal(github.url, 'https://api.github.com/users/AlreadyKyle/settings/billing/usage?year=2026&month=9');
    assert.equal(github.headers.Authorization, 'Bearer github_pat_fixture');
    assert.equal(row.job, 'quota');
    assert.deepEqual(failing(row), ['database_size']);
    assert.match(calls.find((call) => call.url === 'https://ntfy.sh/fixture-topic').body, /^Quotas: database_size: 400\.0 MB of the 350 MB alert line/);
  });
});

describe('main.mjs', () => {
  test('runs a named job, and refuses anything else', async () => {
    const err = sink();
    assert.equal(await main(['backup'], {}, { err }), 2);
    assert.equal(await main(['controller', '--force'], {}, { err }), 2);
    const out = sink();
    const { fetchFn } = fakeFetch();
    assert.equal(await main(['quota', '--dry-run'], QUOTA_ENV, { fetchFn, now: NOW, out }), 0);
    assert.match(out.lines[0], /^PASS: quota /);
    const failed = sink();
    assert.equal(await main(['controller'], { ...CONTROLLER_ENV, STRIPE_READ_KEY: '' }, { out: failed }), 1);
    assert.match(failed.lines[0], /^FAIL: controller: controller env refused:\n {2}- STRIPE_READ_KEY is missing or empty/);
  });
});
