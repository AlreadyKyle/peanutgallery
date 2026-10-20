// The marketing engine's three posters (docs/specs/marketing-engine.md): Bluesky, Mastodon and a
// Discord webhook. Outbound only: each makes POST requests that create a post (and, for Bluesky, the
// session that post needs), and nothing else. No poster reads a timeline, a notification, a reply, a
// mention or a direct message, and no answer body is kept beyond the new post's id. A credential is a
// bearer secret: no result, error or log line carries one, or a URL that holds one (the Discord
// webhook address), only the channel and the HTTP status.
import { DISCORD_WEBHOOK } from '../dispatcher-env.mjs';

export const BLUESKY_DEFAULT_PDS = 'https://bsky.social';
export const DISCORD_USERNAME = 'Mob Machine';
export const POST_TIMEOUT_MS = 20_000;

// Each channel's keys in the marketing job's env (platform/ops/jobs/lib.mjs JOB_KEYS.marketing). A
// channel with any of its required keys unset is skipped with a line naming them, never failed.
export const CHANNEL_KEYS = {
  bsky: { required: ['BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD'], optional: ['BLUESKY_PDS_URL'] },
  mastodon: { required: ['MASTODON_INSTANCE_URL', 'MASTODON_ACCESS_TOKEN'], optional: [] },
  discord: { required: ['DISCORD_WEBHOOK_SHIPS'], optional: [] },
};

// The checks of each channel's values, naming keys only (lib.mjs jobEnvProblems runs them).
export const BLUESKY_HANDLE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/i;
// An app password (Settings, Privacy and security, App passwords): four groups of four. The account's
// own password never has this shape, so it is refused.
export const BLUESKY_APP_PASSWORD = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/;
export const MASTODON_TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

export function channelEnvProblems(env) {
  const problems = [];
  const value = (key) => (env[key] ?? '').trim();
  if (value('BLUESKY_HANDLE') && !BLUESKY_HANDLE.test(value('BLUESKY_HANDLE'))) problems.push('BLUESKY_HANDLE must be a Bluesky handle such as mobmachine.bsky.social, with no @');
  if (value('BLUESKY_APP_PASSWORD') && !BLUESKY_APP_PASSWORD.test(value('BLUESKY_APP_PASSWORD'))) problems.push('BLUESKY_APP_PASSWORD must be an app password (xxxx-xxxx-xxxx-xxxx), never the account password');
  for (const key of ['BLUESKY_PDS_URL', 'MASTODON_INSTANCE_URL']) {
    const raw = value(key);
    if (!raw) continue;
    let url = null;
    try {
      url = new URL(raw);
    } catch {
      url = null;
    }
    if (!url || url.protocol !== 'https:' || url.origin !== raw.replace(/\/+$/, '')) problems.push(`${key} must be an https origin with no path, such as https://mastodon.social`);
  }
  if (value('MASTODON_ACCESS_TOKEN') && !MASTODON_TOKEN.test(value('MASTODON_ACCESS_TOKEN'))) problems.push('MASTODON_ACCESS_TOKEN must be a Mastodon access token');
  if (value('DISCORD_WEBHOOK_SHIPS') && !DISCORD_WEBHOOK.test(value('DISCORD_WEBHOOK_SHIPS'))) problems.push('DISCORD_WEBHOOK_SHIPS must be a Discord webhook address (https://discord.com/api/webhooks/<id>/<token>)');
  return problems;
}

// The required keys a channel is missing; empty when it can post.
export function missingKeys(channel, env) {
  return CHANNEL_KEYS[channel].required.filter((key) => !(env[key] ?? '').trim());
}

async function post(fetchFn, url, headers, body) {
  const response = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  });
  const text = await response.text().catch(() => '');
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, ok: response.ok, json };
}

const failed = (channel, status, what) => ({ ok: false, status, id: null, error: `${channel}: ${what}${status === null ? '' : ` http ${status}`}` });
const thrown = (channel, error) => failed(channel, null, `request failed (${error instanceof Error ? error.name : 'unknown'})`);

// The byte range of each link in the text, as Bluesky's link facets count them (UTF-8 bytes).
export function linkFacets(text, links) {
  const encoder = new TextEncoder();
  const facets = [];
  let from = 0;
  for (const uri of links) {
    const at = text.indexOf(uri, from);
    if (at < 0) continue;
    const byteStart = encoder.encode(text.slice(0, at)).length;
    facets.push({ index: { byteStart, byteEnd: byteStart + encoder.encode(uri).length }, features: [{ $type: 'app.bsky.richtext.facet#link', uri }] });
    from = at + uri.length;
  }
  return facets;
}

// The app.bsky.feed.post record for one message: its text, a link facet for each link, and an
// external embed card for the message's main link.
export function blueskyRecord(message, now) {
  return {
    $type: 'app.bsky.feed.post',
    text: message.text,
    createdAt: now.toISOString(),
    langs: ['en'],
    facets: linkFacets(message.text, message.links),
    embed: {
      $type: 'app.bsky.embed.external',
      external: { uri: message.card.uri, title: message.card.title.slice(0, 300), description: message.card.description.slice(0, 300) },
    },
  };
}

// Bluesky through the AT Protocol: com.atproto.server.createSession with the handle and the app
// password, once a run and only when there is something to post, then
// com.atproto.repo.createRecord for each post.
export function blueskyPoster({ env, fetchFn = fetch, now = () => new Date() }) {
  const pds = ((env.BLUESKY_PDS_URL ?? '').trim() || BLUESKY_DEFAULT_PDS).replace(/\/+$/, '');
  let session = null;
  return {
    channel: 'bsky',
    // Opens the session. false (with the reason) when Bluesky refused it; nothing has been claimed.
    async prepare() {
      if (session) return { ok: true };
      try {
        const answer = await post(fetchFn, `${pds}/xrpc/com.atproto.server.createSession`, {}, { identifier: env.BLUESKY_HANDLE.trim(), password: env.BLUESKY_APP_PASSWORD.trim() });
        const jwt = answer.json?.accessJwt;
        const did = answer.json?.did;
        if (!answer.ok || typeof jwt !== 'string' || typeof did !== 'string') return failed('bsky', answer.status, 'session refused');
        session = { jwt, did };
        return { ok: true };
      } catch (error) {
        return thrown('bsky', error);
      }
    },
    async post(message) {
      const ready = await this.prepare();
      if (!ready.ok) return ready;
      try {
        const answer = await post(fetchFn, `${pds}/xrpc/com.atproto.repo.createRecord`, { Authorization: `Bearer ${session.jwt}` }, {
          repo: session.did,
          collection: 'app.bsky.feed.post',
          record: blueskyRecord(message, now()),
        });
        if (!answer.ok) return failed('bsky', answer.status, 'post refused');
        const uri = answer.json?.uri;
        return { ok: true, status: answer.status, id: typeof uri === 'string' ? uri : null };
      } catch (error) {
        return thrown('bsky', error);
      }
    },
  };
}

// Mastodon: POST /api/v1/statuses on the studio's instance with its access token (scope
// write:statuses alone), public and in English, with an Idempotency-Key so a retried request inside
// Mastodon's window makes no second status.
export function mastodonPoster({ env, fetchFn = fetch }) {
  const instance = env.MASTODON_INSTANCE_URL.trim().replace(/\/+$/, '');
  return {
    channel: 'mastodon',
    async prepare() {
      return { ok: true };
    },
    async post(message) {
      try {
        const answer = await post(
          fetchFn,
          `${instance}/api/v1/statuses`,
          { Authorization: `Bearer ${env.MASTODON_ACCESS_TOKEN.trim()}`, 'Idempotency-Key': message.key },
          { status: message.text, visibility: 'public', language: 'en' },
        );
        if (!answer.ok) return failed('mastodon', answer.status, 'post refused');
        const id = answer.json?.id;
        return { ok: true, status: answer.status, id: typeof id === 'string' ? id : null };
      } catch (error) {
        return thrown('mastodon', error);
      }
    },
  };
}

// Discord: the studio's existing ships webhook, as the dispatcher posts to it (platform/dispatcher/
// src/discord.ts): the studio's username, no mention allowed, and ?wait=true for the message id.
export function discordPoster({ env, fetchFn = fetch }) {
  const url = env.DISCORD_WEBHOOK_SHIPS.trim();
  return {
    channel: 'discord',
    async prepare() {
      return { ok: true };
    },
    async post(message) {
      try {
        const answer = await post(fetchFn, `${url}?wait=true`, {}, { content: message.text, username: DISCORD_USERNAME, allowed_mentions: { parse: [] } });
        if (!answer.ok) return failed('discord', answer.status, 'post refused');
        const id = answer.json?.id;
        return { ok: true, status: answer.status, id: typeof id === 'string' ? id : null };
      } catch (error) {
        return thrown('discord', error);
      }
    },
  };
}

export const POSTERS = { bsky: blueskyPoster, mastodon: mastodonPoster, discord: discordPoster };
