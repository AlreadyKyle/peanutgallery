// Kernel (platform/gate/kernel-paths.txt; docs/specs/ship-notices.md, docs/specs/card-follows.md): the
// one-click unsubscribe for ship notices and for the emails about cards a player follows, served by
// the card function at /api/unsubscribe on the site's own origin.
//
//   GET  /api/unsubscribe?p=<payment id>&t=<token>  a small page with one button that posts to the
//        same address; it changes nothing, so a mail scanner that opens the link unsubscribes nobody
//   POST /api/unsubscribe?p=<payment id>&t=<token>  ship_notice_unsubscribe(p_payment, p_token) with
//        the publishable key; the mail client's one-click unsubscribe (RFC 8058) posts here with the
//        body List-Unsubscribe=One-Click, which is not read
//   GET|POST /api/unsubscribe?f=<user id>&t=<token>  the same for a follow email:
//        follow_unsubscribe(p_user, p_token), which ends every follow of that profile
//
// The database checks the token against a secret it never hands out, and writes only on a match, so
// the function holds no secret. p or f must be a uuid and t 64 lowercase hex characters, or it answers
// 400 before Supabase is called. Every answer is no-store, plain HTML with no script or style. A
// function's answer does not get netlify.toml's [[headers]], so each page carries its own: a policy
// that loads nothing, lets the form post only to this origin and refuses every frame (the one button
// cannot be clickjacked), with X-Frame-Options, nosniff and no referrer. The body names no address,
// payment, profile or card.

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './public-env.ts';

export const UNSUBSCRIBE_PATH = '/api/unsubscribe';
/** How long the RPC call may take before the function answers 502. */
export const UNSUBSCRIBE_TIMEOUT_MS = 8_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^[0-9a-f]{64}$/;
const HTML_TYPE = 'text/html; charset=utf-8';
const NO_STORE = { 'Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store' };
/** The page has no script, style, image or font, so it loads nothing; its one form posts to this origin. */
export const UNSUBSCRIBE_POLICY = "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const PAGE_HEADERS = {
  'Content-Security-Policy': UNSUBSCRIBE_POLICY,
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

type Copy = { title: string; ask: string; button: string; done: string; invalid: string; failed: string; back: string };

/** The ship notices' page, and the page for a link that is not valid. */
export const unsubscribeCopy = {
  title: 'Ship notices',
  ask: 'Stop the emails Mob Machine sends when a card you funded ships?',
  button: 'Stop ship notices',
  done: 'Done. Mob Machine will send you no more ship notices, for this or any other contribution made with the same email address.',
  invalid: 'This unsubscribe link is not valid. Email hello@clayhouse.studio and the studio will stop the notices by hand.',
  failed: 'The studio could not record this just now. Try the link again in a few minutes, or email hello@clayhouse.studio.',
  back: 'Back to Mob Machine',
} as const satisfies Copy;

/** The page for the emails about cards a player follows (docs/specs/card-follows.md). */
export const followUnsubscribeCopy = {
  title: 'Cards you follow',
  ask: 'Stop the emails Mob Machine sends when a card you follow ships? This stops following every card for you.',
  button: 'Stop these emails',
  done: 'Done. You follow no cards now, so Mob Machine will send you no more of these emails. Press Tell me when this ships on a card to follow it again.',
  invalid: unsubscribeCopy.invalid,
  failed: unsubscribeCopy.failed,
  back: unsubscribeCopy.back,
} as const satisfies Copy;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function page(copy: Copy, status: number, body: string, extra: Record<string, string> = {}): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(copy.title)} · Mob Machine</title>
</head>
<body>
<main>
<h1>${escapeHtml(copy.title)}</h1>
${body}
<p><a href="/">${escapeHtml(copy.back)}</a></p>
</main>
</body>
</html>
`;
  return new Response(html, { status, headers: { 'Content-Type': HTML_TYPE, ...NO_STORE, ...PAGE_HEADERS, ...extra } });
}

const paragraph = (text: string) => `<p>${escapeHtml(text)}</p>`;

type Link = { kind: 'payment' | 'follow'; id: string; token: string };

const KINDS = {
  payment: { key: 'p', rpc: 'ship_notice_unsubscribe', arg: 'p_payment', copy: unsubscribeCopy },
  follow: { key: 'f', rpc: 'follow_unsubscribe', arg: 'p_user', copy: followUnsubscribeCopy },
} as const;

/** The kind of link, its id and its token from the address, or null when any is missing or malformed. */
export function linkFrom(url: URL): Link | null {
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 2 || !keys.includes('t')) return null;
  const kind = keys.includes('p') ? 'payment' : keys.includes('f') ? 'follow' : null;
  if (kind === null) return null;
  const id = url.searchParams.get(KINDS[kind].key) ?? '';
  const token = url.searchParams.get('t') ?? '';
  return UUID.test(id) && TOKEN.test(token) ? { kind, id, token } : null;
}

/** true, false, or null when Supabase errs, times out or answers something that is not a boolean. */
async function unsubscribeRpc(link: Link): Promise<boolean | null> {
  const kind = KINDS[link.kind];
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${kind.rpc}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ [kind.arg]: link.id, p_token: link.token }),
      signal: AbortSignal.timeout(UNSUBSCRIBE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const parsed: unknown = JSON.parse(await response.text());
    return typeof parsed === 'boolean' ? parsed : null;
  } catch {
    return null;
  }
}

export async function unsubscribe(req: Request): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return page(unsubscribeCopy, 405, paragraph(unsubscribeCopy.invalid), { Allow: 'GET, POST' });
  }
  const url = new URL(req.url);
  const link = linkFrom(url);
  if (link === null) return page(unsubscribeCopy, 400, paragraph(unsubscribeCopy.invalid));
  const { copy, key } = KINDS[link.kind];
  if (req.method === 'GET') {
    const action = `${UNSUBSCRIBE_PATH}?${key}=${link.id}&t=${link.token}`;
    return page(
      copy,
      200,
      `${paragraph(copy.ask)}\n<form method="post" action="${escapeHtml(action)}"><button type="submit">${escapeHtml(copy.button)}</button></form>`,
    );
  }
  const result = await unsubscribeRpc(link);
  if (result === null) return page(copy, 502, paragraph(copy.failed));
  if (!result) return page(copy, 400, paragraph(copy.invalid));
  return page(copy, 200, paragraph(copy.done));
}
