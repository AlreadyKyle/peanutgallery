// Postiz Cloud's public API (https://docs.postiz.com): one API key for the channels whose own APIs
// need an app audit or paid access (X, Threads, YouTube, TikTok, Instagram, LinkedIn). Each channel
// is connected once in the Postiz UI; the engine finds its integration id by the provider identifier.
// The analytics endpoint is limited to 30 requests an hour, so metrics.mjs caps its reads.
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { ROOT } from '../lib.mjs';
import { getJson } from './index.mjs';

const API = 'https://api.postiz.com';
// Postiz provider identifiers per engine channel; the first one connected wins.
export const IDENTIFIERS = {
  x: ['x', 'twitter'],
  threads: ['threads'],
  youtube: ['youtube'],
  tiktok: ['tiktok'],
  instagram: ['instagram', 'instagram-standalone'],
  linkedin: ['linkedin-page', 'linkedin'],
};

const headers = (env) => ({ Authorization: env.PROMO_POSTIZ_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' });
const apiBase = (env) => env.PROMO_POSTIZ_API_URL || API;

let integrationsCache = null;
export function resetCache() {
  integrationsCache = null;
}

async function integrationFor(channel, { env, fetch: f }) {
  integrationsCache ??= await getJson(await f(`${apiBase(env)}/public/v1/integrations`, { headers: headers(env) }), 'postiz integrations');
  const list = Array.isArray(integrationsCache) ? integrationsCache : integrationsCache.integrations ?? [];
  for (const id of IDENTIFIERS[channel] ?? [channel]) {
    const hit = list.find((i) => (i.identifier ?? i.providerIdentifier) === id && !i.disabled);
    if (hit) return hit.id;
  }
  return null;
}

async function upload(bytes, filename, type, { env, fetch: f }) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), filename);
  const response = await f(`${apiBase(env)}/public/v1/upload`, { method: 'POST', headers: { Authorization: env.PROMO_POSTIZ_API_KEY }, body: form });
  const body = await getJson(response, 'postiz upload');
  return { id: body.id ?? basename(body.path), path: body.path };
}

/** The provider settings each channel needs (Postiz silently drops settings that do not apply). */
export function settingsFor(channel, draft) {
  switch (channel) {
    case 'x':
      return { who_can_reply_post: 'everyone' };
    case 'youtube':
      return { title: (draft.title ?? draft.text).slice(0, 95), type: 'public', selfDeclaredMadeForKids: 'no' };
    case 'tiktok':
      return { privacy_level: 'PUBLIC_TO_EVERYONE', duet: true, stitch: true, comment: true, autoAddMusic: 'no', brand_content_toggle: false, brand_organic_toggle: false, content_posting_method: 'DIRECT_POST' };
    case 'instagram':
      return { post_type: 'post' };
    default:
      return {};
  }
}

export function forChannel(channel) {
  return {
    ready: (env) => Boolean(env.PROMO_POSTIZ_API_KEY),
    async send(draft, ctx) {
      const f = ctx.fetch ?? fetch;
      const integration = await integrationFor(channel, { ...ctx, fetch: f });
      if (!integration) throw new Error(`no ${channel} channel is connected in Postiz`);
      const image = [];
      if (draft.video) {
        const file = resolve(ctx.root ?? ROOT, draft.video);
        image.push(await upload(readFileSync(file), basename(file), 'video/mp4', { ...ctx, fetch: f }));
      } else if (draft.image) {
        const response = await f(draft.image);
        if (response.ok) image.push(await upload(Buffer.from(await response.arrayBuffer()), 'card.png', 'image/png', { ...ctx, fetch: f }));
      }
      const body = {
        type: 'now',
        date: new Date().toISOString(),
        shortLink: false,
        tags: [],
        posts: [{ integration: { id: integration }, value: [{ content: `${draft.text}\n\n${draft.link}`, image }], settings: { __type: IDENTIFIERS[channel]?.[0] ?? channel, ...settingsFor(channel, draft) } }],
      };
      const created = await getJson(await f(`${apiBase(ctx.env)}/public/v1/posts`, { method: 'POST', headers: headers(ctx.env), body: JSON.stringify(body) }), 'postiz post');
      const first = Array.isArray(created) ? created[0] : created;
      return { postId: first?.postId ?? first?.id ?? null, url: first?.releaseURL ?? null, integration };
    },
    async stats(receipt, ctx) {
      const f = ctx.fetch ?? fetch;
      if (!receipt.postId) return null;
      const rows = await getJson(await f(`${apiBase(ctx.env)}/public/v1/analytics/post/${receipt.postId}?date=7`, { headers: headers(ctx.env) }), 'postiz analytics');
      if (!Array.isArray(rows)) return null;
      const total = (re) => {
        const row = rows.find((r) => re.test(r.label ?? ''));
        if (!row) return 0;
        const data = row.data ?? [];
        return Number(data.at(-1)?.total ?? data.reduce((s, d) => s + Number(d.total ?? 0), 0)) || 0;
      };
      return { likes: total(/like|favou?rite/i), reposts: total(/retweet|repost|share/i), replies: total(/repl|comment/i), quotes: total(/quote/i), views: total(/impression|view/i), clicks: total(/click/i) };
    },
  };
}
