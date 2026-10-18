// Bluesky over the AT Protocol with an app password (Settings, Privacy and security, App passwords).
// Free. Posts carry a link facet and a link card with the card's preview image.
import { getJson } from './index.mjs';

const PDS = 'https://bsky.social/xrpc';
const APPVIEW = 'https://public.api.bsky.app/xrpc';

export const ready = (env) => Boolean(env.PROMO_BLUESKY_HANDLE && env.PROMO_BLUESKY_APP_PASSWORD);

async function session(env, f) {
  const response = await f(`${PDS}/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: env.PROMO_BLUESKY_HANDLE, password: env.PROMO_BLUESKY_APP_PASSWORD }),
  });
  return getJson(response, 'bluesky session');
}

/** Byte offsets of the link in the UTF-8 text, which is what Bluesky facets index. */
export function linkFacet(text, link) {
  const start = Buffer.byteLength(text.slice(0, text.indexOf(link)), 'utf8');
  return { index: { byteStart: start, byteEnd: start + Buffer.byteLength(link, 'utf8') }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: link }] };
}

export async function send(draft, { env, fetch: f = fetch }) {
  const s = await session(env, f);
  const auth = { Authorization: `Bearer ${s.accessJwt}` };
  const text = `${draft.text}\n\n${draft.link}`;
  const record = { $type: 'app.bsky.feed.post', text, createdAt: new Date().toISOString(), langs: ['en'], facets: [linkFacet(text, draft.link)] };
  const external = { uri: draft.link, title: draft.cardTitle ?? 'Mob Machine', description: draft.text.slice(0, 200) };
  if (draft.image) {
    try {
      const image = await f(draft.image);
      if (image.ok) {
        const bytes = Buffer.from(await image.arrayBuffer());
        const blob = await getJson(
          await f(`${PDS}/com.atproto.repo.uploadBlob`, { method: 'POST', headers: { ...auth, 'Content-Type': image.headers.get('content-type') ?? 'image/png' }, body: bytes }),
          'bluesky upload',
        );
        external.thumb = blob.blob;
      }
    } catch {
      // A post without a thumbnail is still a post.
    }
  }
  record.embed = { $type: 'app.bsky.embed.external', external };
  const created = await getJson(
    await f(`${PDS}/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: s.did, collection: 'app.bsky.feed.post', record }),
    }),
    'bluesky post',
  );
  const rkey = created.uri.split('/').pop();
  return { postId: created.uri, url: `https://bsky.app/profile/${env.PROMO_BLUESKY_HANDLE}/post/${rkey}` };
}

export async function stats(receipt, { fetch: f = fetch }) {
  const body = await getJson(await f(`${APPVIEW}/app.bsky.feed.getPosts?uris=${encodeURIComponent(receipt.postId)}`), 'bluesky stats');
  const post = body.posts?.[0];
  if (!post) return null;
  return { likes: post.likeCount ?? 0, reposts: post.repostCount ?? 0, replies: post.replyCount ?? 0, quotes: post.quoteCount ?? 0 };
}
