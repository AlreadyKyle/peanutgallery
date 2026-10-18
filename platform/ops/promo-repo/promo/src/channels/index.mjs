// Channel adapters. Each has ready(env) (are its credentials present), send(draft, ctx) returning
// { postId, url }, and stats(receipt, ctx) returning { likes, reposts, replies, quotes, views, clicks }
// or null when the channel reports nothing. ctx is { env, fetch, root }.
import * as bluesky from './bluesky.mjs';
import * as discord from './discord.mjs';
import * as mastodon from './mastodon.mjs';
import * as postiz from './postiz.mjs';

const DIRECT = { bluesky, discord, mastodon };

export function adapterFor(channel, config) {
  const via = config.channels[channel]?.via ?? 'postiz';
  if (via === 'direct' && DIRECT[channel]) return DIRECT[channel];
  if (via === 'postiz') return postiz.forChannel(channel);
  return null;
}

export async function getJson(response, what) {
  const text = await response.text();
  if (!response.ok) throw new Error(`${what} answered ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
