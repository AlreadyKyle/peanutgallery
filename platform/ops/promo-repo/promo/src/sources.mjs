// Reads the studio's public documents: the same RPCs the site serves, with the publishable key,
// so the engine sees only what anyone may see. No secret is needed to harvest.
export async function rpc(config, name, args = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: config.supabasePublishableKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${name} answered ${response.status}`);
  return response.json();
}

/** The documents a harvest reads. A document that fails is reported and left out, never fatal. */
export async function readPublic(config, fetchImpl = fetch) {
  const wanted = {
    cards: ['site_cards', {}],
    live: ['site_live', {}],
    reports: ['site_reports', {}],
    feed: ['community_feed', {}],
    goals: ['community_goals', {}],
    studio: ['community_studio', {}],
    seeds: ['community_seeds', { p_sort: 'trending' }],
  };
  const out = { errors: [] };
  await Promise.all(
    Object.entries(wanted).map(async ([key, [name, args]]) => {
      try {
        out[key] = await rpc(config, name, args, fetchImpl);
      } catch (error) {
        out.errors.push(`${key}: ${error.message}`);
        out[key] = null;
      }
    }),
  );
  return out;
}
