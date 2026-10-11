// The ship notices job (docs/specs/ship-notices.md): when a card a supporter's payment reached ships,
// one email per payment and shipped card, run by the ops repository's jobs.yml. For each row of
// ship_notices_due() it:
//   1. reads that payment's Checkout Session from Stripe with the restricted read key (GET only) for
//      the receipt address Stripe already holds, customer_details.email. The address is held in this
//      process for the one send and never written, logged or printed;
//   2. claims the (payment, card) pair with ship_notice_claim(), which answers true once only;
//   3. sends one email through Resend's API from the studio's existing sender, with an Idempotency-Key
//      of the pair, so a retried request inside Resend's window sends nothing new, and a one-click
//      unsubscribe (List-Unsubscribe and List-Unsubscribe-Post, RFC 8058) to the site's
//      /api/unsubscribe with the payment id and the token the database made for it;
//   4. settles the pair as sent (with Resend's id), failed or no_address.
// A pair is claimed before its send and never claimed again, so no notice goes twice: a send whose
// answer is lost is settled failed, not retried, and the board is told. Unsubscribed contributors are
// left out by ship_notices_due() itself.
//
// --dry-run reads the due rows and Stripe and prints the count it would send; it claims, sends and
// alerts nothing. The first output line is PASS: or FAIL:, and names counts only.
import { readFileSync } from 'node:fs';
import { alerter, JobEnvError, jobEnvProblems, round2, stripeApiVersion, stripeReader, supabaseClient } from './lib.mjs';

// The studio's sender: the address Supabase Auth's sign-in email already uses through Resend
// (BOARD-SETUP.md step 13), on the verified domain. Replies go to the public contact address.
export const NOTICE_FROM = 'Mob Machine <board@mobmachine.games>';
export const NOTICE_REPLY_TO = 'hello@clayhouse.studio';
export const SITE_URL = 'https://mobmachine.games';
export const RESEND_URL = 'https://api.resend.com/emails';
// At most this many notices a run. Resend's free plan sends 100 emails a day; the job runs once a day.
export const NOTICES_PER_RUN = 50;
// Resend allows 2 requests a second; one send every 600 ms stays under it.
export const SEND_GAP_MS = 600;
// A claim still at sending after this long is a send whose answer was lost; the board is told.
export const STUCK_AFTER_MS = 60 * 60 * 1000;

// The game's play address, from the site's build values (platform/site/netlify.toml VITE_PLAY_URL),
// the one place it is set, so the email and the site's Play link never differ.
export function playUrl(file = new URL('../../site/netlify.toml', import.meta.url)) {
  const value = /^\s*VITE_PLAY_URL\s*=\s*"([^"]+)"/m.exec(readFileSync(file, 'utf8'))?.[1] ?? '';
  if (!/^https:\/\/[^\s"]+$/.test(value)) throw new Error('VITE_PLAY_URL not found in platform/site/netlify.toml');
  return value;
}

export function unsubscribeUrl(paymentId, token) {
  return `${SITE_URL}/api/unsubscribe?p=${paymentId}&t=${token}`;
}

const usd = (value) => `$${round2(value).toFixed(2)}`;
const oneLine = (text) => String(text).replace(/\s+/g, ' ').trim();
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The email for one due row: the card's title, that it is live, what the agents spent, its page and
// the game's play address, and the unsubscribe. Pure: no address in it, the caller adds the recipient.
export function composeNotice(row, play) {
  const title = oneLine(row.card_title);
  const cardUrl = `${SITE_URL}/card/${row.card_id}`;
  const stop = unsubscribeUrl(row.payment_id, row.unsubscribe_token);
  const spent = usd(row.cost_usd);
  const subject = `Shipped: ${title}`;
  const lines = [
    'A card you funded has shipped.',
    '',
    `${title} is live.`,
    `The agents spent ${spent} building it.`,
    '',
    `See the card: ${cardUrl}`,
    `Play the game: ${play}`,
    '',
    'Thank you for funding it.',
    'Mob Machine',
    '',
    'You get this email once for each card your contribution reached when it ships.',
    `Stop ship notices: ${stop}`,
  ];
  const html = [
    '<p>A card you funded has shipped.</p>',
    `<p><strong>${escapeHtml(title)}</strong> is live. The agents spent ${escapeHtml(spent)} building it.</p>`,
    `<p><a href="${escapeHtml(cardUrl)}">See the card</a> · <a href="${escapeHtml(play)}">Play the game</a></p>`,
    '<p>Thank you for funding it.<br>Mob Machine</p>',
    `<p>You get this email once for each card your contribution reached when it ships. <a href="${escapeHtml(stop)}">Stop ship notices</a></p>`,
  ].join('\n');
  return {
    subject,
    text: `${lines.join('\n')}\n`,
    html,
    headers: { 'List-Unsubscribe': `<${stop}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    idempotencyKey: `ship-notice/${row.payment_id}/${row.card_id}`,
  };
}

// The receipt address Stripe holds for the session, or null when it holds none.
export function sessionEmail(session) {
  const email = session?.customer_details?.email;
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+$/.test(email.trim()) ? email.trim() : null;
}

// One send through Resend: its message id, or an error naming the status only (never the address).
export async function sendNotice({ key, fetchFn = fetch, to, notice }) {
  let response;
  try {
    response = await fetchFn(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': notice.idempotencyKey },
      body: JSON.stringify({
        from: NOTICE_FROM,
        to: [to],
        reply_to: NOTICE_REPLY_TO,
        subject: notice.subject,
        text: notice.text,
        html: notice.html,
        headers: notice.headers,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    return { ok: false, error: `resend: ${error instanceof Error ? error.name : 'request failed'}` };
  }
  const text = await response.text();
  if (!response.ok) return { ok: false, error: `resend: http ${response.status}` };
  try {
    const id = JSON.parse(text)?.id;
    return { ok: true, id: typeof id === 'string' ? id : null };
  } catch {
    return { ok: true, id: null };
  }
}

export async function runNotices({ env, dryRun = false, fetchFn = fetch, now = new Date(), out = process.stdout, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), play = playUrl() }) {
  const problems = jobEnvProblems('notices', env);
  if (problems.length > 0) throw new JobEnvError('notices', problems);
  const db = supabaseClient({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY, fetchFn });
  const stripe = stripeReader({ key: env.STRIPE_READ_KEY, fetchFn, version: stripeApiVersion() });
  const alerts = alerter({ ntfyUrl: env.NTFY_TOPIC_URL, healthcheckUrl: env.NOTICES_HEALTHCHECK_URL, fetchFn, title: 'Mob Machine ship notices' });

  const due = await db.rpc('ship_notices_due', { p_limit: NOTICES_PER_RUN });
  if (!Array.isArray(due)) throw new Error('ship_notices_due did not answer a list');
  const counts = { due: due.length, sent: 0, no_address: 0, failed: 0, skipped: 0, stripe_unread: 0 };
  const failures = [];
  let sends = 0;
  for (const row of due) {
    let session;
    try {
      session = await stripe.get(`checkout/sessions/${encodeURIComponent(row.stripe_session_id)}`);
    } catch (error) {
      // Nothing is claimed, so the next run tries this pair again.
      counts.stripe_unread += 1;
      failures.push(`payment ${row.payment_id}: Stripe session not read (${error?.status ?? 'no answer'})`);
      continue;
    }
    const to = sessionEmail(session);
    const notice = composeNotice(row, play);
    if (dryRun) {
      counts[to ? 'sent' : 'no_address'] += 1;
      continue;
    }
    if (!(await db.rpc('ship_notice_claim', { p_payment: row.payment_id, p_card: row.card_id }))) {
      counts.skipped += 1;
      continue;
    }
    if (!to) {
      await db.rpc('ship_notice_settle', { p_payment: row.payment_id, p_card: row.card_id, p_status: 'no_address', p_provider_id: null });
      counts.no_address += 1;
      continue;
    }
    if (sends > 0) await sleep(SEND_GAP_MS);
    sends += 1;
    const result = await sendNotice({ key: env.RESEND_API_KEY, fetchFn, to, notice });
    await db.rpc('ship_notice_settle', {
      p_payment: row.payment_id,
      p_card: row.card_id,
      p_status: result.ok ? 'sent' : 'failed',
      p_provider_id: result.ok ? result.id : null,
    });
    if (result.ok) counts.sent += 1;
    else {
      counts.failed += 1;
      failures.push(`payment ${row.payment_id} card ${row.card_id}: ${result.error}; not retried`);
    }
  }

  // A claim left at sending for over an hour lost its answer between the send and the settle.
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MS).toISOString();
  const stuck = dryRun ? [] : await db.select('ship_notices', `select=payment_id,card_id&status=eq.sending&created_at=lt.${encodeURIComponent(stuckBefore)}`);
  for (const row of Array.isArray(stuck) ? stuck : []) failures.push(`payment ${row.payment_id} card ${row.card_id}: claimed but never settled; check Resend's log before sending by hand`);

  const summary = `due ${counts.due}, ${dryRun ? 'would send' : 'sent'} ${counts.sent}, no address ${counts.no_address}, failed ${counts.failed}, Stripe unread ${counts.stripe_unread}, already claimed ${counts.skipped}`;
  const ok = failures.length === 0;
  out.write(`${ok ? 'PASS' : 'FAIL'}: notices${dryRun ? ' (dry run)' : ''}: ${summary}\n`);
  for (const failure of failures) out.write(`  - ${failure}\n`);
  if (!dryRun) {
    if (!ok) await alerts.notify(`Ship notices: ${summary}\n${failures.map((f) => `- ${f}`).join('\n')}`);
    await alerts.ping(ok);
  }
  return { ok, counts, failures };
}
