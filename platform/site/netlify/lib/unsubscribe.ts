// Kernel (platform/gate/kernel-paths.txt; docs/specs/ship-notices.md): the one-click unsubscribe for
// ship notices, served by the card function at /api/unsubscribe on the site's own origin.
//
//   GET  /api/unsubscribe?p=<payment id>&t=<token>  a small page with one button that posts to the
//        same address; it changes nothing, so a mail scanner that opens the link unsubscribes nobody
//   POST /api/unsubscribe?p=<payment id>&t=<token>  ship_notice_unsubscribe(p_payment, p_token) with
//        the publishable key; the mail client's one-click unsubscribe (RFC 8058) posts here with the
//        body List-Unsubscribe=One-Click, which is not read
//
// The database checks the token against a secret it never hands out, and writes only on a match, so
// the function holds no secret. p must be a uuid and t 64 lowercase hex characters, or it answers 400
// before Supabase is called. Every answer is no-store, plain HTML with no script or style, so the
// site's Content-Security-Policy holds. The body names no address, payment or card.

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './public-env.ts';

export const UNSUBSCRIBE_PATH = '/api/unsubscribe';
/** How long the RPC call may take before the function answers 502. */
export const UNSUBSCRIBE_TIMEOUT_MS = 8_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^[0-9a-f]{64}$/;
const HTML_TYPE = 'text/html; charset=utf-8';
const NO_STORE = { 'Cache-Control': 'no-store', 'Netlify-CDN-Cache-Control': 'no-store' };

export const unsubscribeCopy = {
  title: 'Ship notices',
  ask: 'Stop the emails Mob Machine sends when a card you funded ships?',
  button: 'Stop ship notices',
  done: 'Done. Mob Machine will send you no more ship notices, for this or any other contribution made with the same email address.',
  invalid: 'This unsubscribe link is not valid. Email hello@clayhouse.studio and the studio will stop the notices by hand.',
  failed: 'The studio could not record this just now. Try the link again in a few minutes, or email hello@clayhouse.studio.',
  back: 'Back to Mob Machine',
} as const;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function page(status: number, body: string, extra: Record<string, string> = {}): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(unsubscribeCopy.title)} · Mob Machine</title>
</head>
<body>
<main>
<h1>${escapeHtml(unsubscribeCopy.title)}</h1>
${body}
<p><a href="/">${escapeHtml(unsubscribeCopy.back)}</a></p>
</main>
</body>
</html>
`;
  return new Response(html, { status, headers: { 'Content-Type': HTML_TYPE, ...NO_STORE, ...extra } });
}

const paragraph = (text: string) => `<p>${escapeHtml(text)}</p>`;

/** The payment id and token from the address, or null when either is missing or malformed. */
export function linkFrom(url: URL): { payment: string; token: string } | null {
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 2 || !keys.includes('p') || !keys.includes('t')) return null;
  const payment = url.searchParams.get('p') ?? '';
  const token = url.searchParams.get('t') ?? '';
  return UUID.test(payment) && TOKEN.test(token) ? { payment, token } : null;
}

/** true, false, or null when Supabase errs, times out or answers something that is not a boolean. */
async function unsubscribeRpc(payment: string, token: string): Promise<boolean | null> {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ship_notice_unsubscribe`, {
      method: 'POST',
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ p_payment: payment, p_token: token }),
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
    return page(405, paragraph(unsubscribeCopy.invalid), { Allow: 'GET, POST' });
  }
  const url = new URL(req.url);
  const link = linkFrom(url);
  if (link === null) return page(400, paragraph(unsubscribeCopy.invalid));
  if (req.method === 'GET') {
    const action = `${UNSUBSCRIBE_PATH}?p=${link.payment}&t=${link.token}`;
    return page(
      200,
      `${paragraph(unsubscribeCopy.ask)}\n<form method="post" action="${escapeHtml(action)}"><button type="submit">${escapeHtml(unsubscribeCopy.button)}</button></form>`,
    );
  }
  const result = await unsubscribeRpc(link.payment, link.token);
  if (result === null) return page(502, paragraph(unsubscribeCopy.failed));
  if (!result) return page(400, paragraph(unsubscribeCopy.invalid));
  return page(200, paragraph(unsubscribeCopy.done));
}
