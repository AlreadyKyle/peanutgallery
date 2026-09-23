// The public site never names the board's own site (docs/specs/board-site.md). The board site lives
// at a *.netlify.app address, but so does the game, and every page's top bar links to the game at
// VITE_PLAY_URL from netlify.toml. So the check allows that one host and fails on any other
// netlify.app host a page names; when BOARD_SITE_URL is set (in .env, never committed), it also
// fails on the board site's own host wherever it appears. live-check.mjs, the site's unit tests and
// its end-to-end suite all use these.

/** The host of the VITE_PLAY_URL a netlify.toml builds the site with, lower-cased, or null. */
export function playHostFrom(toml) {
  const url = toml.match(/^\s*VITE_PLAY_URL\s*=\s*"([^"]*)"\s*$/m)?.[1];
  if (url === undefined || url === '') return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Every *.netlify.app host the text names, lower-cased, once each, in the order found. */
export function netlifyHosts(text) {
  const hosts = [...text.matchAll(/(?<![A-Za-z0-9-])(?:[A-Za-z0-9-]+\.)+netlify\.app(?![A-Za-z0-9-])/gi)].map((match) => match[0].toLowerCase());
  return [...new Set(hosts)];
}

/** The netlify.app hosts the text names other than the allowed ones. */
export function strayNetlifyHosts(text, allowed) {
  const ok = new Set(allowed.map((host) => host.toLowerCase()));
  return netlifyHosts(text).filter((host) => !ok.has(host));
}

/** The board site's host from a BOARD_SITE_URL value, lower-cased, or null when it is unset or not a URL. */
export function boardHostFrom(value) {
  if (value === undefined || value === null || value.trim() === '') return null;
  try {
    return new URL(value.trim()).host.toLowerCase();
  } catch {
    return null;
  }
}
