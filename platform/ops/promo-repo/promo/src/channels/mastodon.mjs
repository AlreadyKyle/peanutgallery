// Mastodon with an application access token (Preferences, Development, New application; scopes
// read:statuses write:statuses write:media). Free. Choose an instance that allows automated accounts
// and mark the account as automated in its profile.
import { getJson } from './index.mjs';

export const ready = (env) => Boolean(env.PROMO_MASTODON_URL && env.PROMO_MASTODON_TOKEN);

export async function send(draft, { env, fetch: f = fetch }) {
  const response = await f(`${env.PROMO_MASTODON_URL}/api/v1/statuses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.PROMO_MASTODON_TOKEN}`, 'Content-Type': 'application/json', 'Idempotency-Key': draft.id },
    body: JSON.stringify({ status: `${draft.text}\n\n${draft.link}`, visibility: 'public', language: 'en' }),
  });
  const body = await getJson(response, 'mastodon');
  return { postId: body.id, url: body.url };
}

export async function stats(receipt, { env, fetch: f = fetch }) {
  const body = await getJson(
    await f(`${env.PROMO_MASTODON_URL}/api/v1/statuses/${receipt.postId}`, { headers: { Authorization: `Bearer ${env.PROMO_MASTODON_TOKEN}` } }),
    'mastodon stats',
  );
  return { likes: body.favourites_count ?? 0, reposts: body.reblogs_count ?? 0, replies: body.replies_count ?? 0 };
}
