// Discord through a channel webhook: free, outbound only. Discord reports no per-message stats to a
// webhook, so its outcome is measured on the site (the from=discord tag).
import { getJson } from './index.mjs';

export const ready = (env) => Boolean(env.PROMO_DISCORD_WEBHOOK_URL);

export async function send(draft, { env, fetch: f = fetch }) {
  const response = await f(`${env.PROMO_DISCORD_WEBHOOK_URL}?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `${draft.text}\n${draft.link}`, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await getJson(response, 'discord');
  return { postId: body.id ?? null, url: body.channel_id && body.id ? `https://discord.com/channels/@me/${body.channel_id}/${body.id}` : null };
}

export async function stats() {
  return null;
}
