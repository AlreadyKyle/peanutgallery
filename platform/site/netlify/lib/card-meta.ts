// Kernel (platform/gate/kernel-paths.txt; docs/specs/card-preview.md): the link preview tags of a
// card's own page. A link preview reader runs no script, so the page the app draws at /card/:id
// cannot name its own preview; the edge function card-meta.ts puts the card's title, summary, address
// and preview image into index.html's tags, and a canonical link to the card's address
// (docs/specs/page-previews.md), before the page leaves the CDN. Web APIs only: it runs on
// Deno at the edge and under vitest here.

export const SITE = 'https://mobmachine.games';
/** The studio name, as src/lib/copy.ts holds it; card-preview.test.ts checks it. */
export const STUDIO_NAME = 'Mob Machine';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_PATH = /^\/card\/([^/]+)\/?$/;

/** The card id of a /card/:id path, lower case, or null. */
export function cardIdFrom(pathname: string): string | null {
  const match = PAGE_PATH.exec(pathname);
  return match !== null && UUID.test(match[1]!) ? match[1]!.toLowerCase() : null;
}

export function escapeAttr(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const CANONICAL = /<link rel="canonical" href="[^"]*" \/>/;

/**
 * The page with one canonical link to `url` (docs/specs/page-previews.md): the one there replaced, or
 * a new one at the end of the head. index.html carries none, since it is served at every path; each
 * edge function names its own page's address, so a tagged link (?from=) counts as that page.
 */
export function withCanonical(html: string, url: string): string {
  const link = `<link rel="canonical" href="${escapeAttr(url)}" />`;
  if (CANONICAL.test(html)) return html.replace(CANONICAL, () => link);
  return html.replace(/(\n?)([ \t]*)<\/head>/, (_, newline: string, indent: string) => `${newline}${indent}  ${link}\n${indent}</head>`);
}

/** A card's folder as what it changes: a game by its name, or this site (src/lib/legal.ts folders). */
const CHANGES: Record<string, { game: string | null; what: string }> = {
  'seed-1': { game: 'Dust', what: 'Dust' },
  platform: { game: null, what: 'this site' },
};

export type CardMeta = { title: string; summary: string; folder?: string };

/** The title, summary and folder from /api/card's JSON text, or null. */
export function metaFrom(body: string): CardMeta | null {
  try {
    const root: unknown = JSON.parse(body);
    if (typeof root !== 'object' || root === null) return null;
    const card = (root as Record<string, unknown>).card;
    if (typeof card !== 'object' || card === null) return null;
    const { title, summary, folder } = card as Record<string, unknown>;
    if (typeof title !== 'string' || title.trim() === '') return null;
    const meta: CardMeta = { title: title.trim(), summary: typeof summary === 'string' ? summary.trim() : '' };
    if (typeof folder === 'string') meta.folder = folder;
    return meta;
  } catch {
    return null;
  }
}

/**
 * index.html with the card's own tags in place of the site's, by attribute; other tags untouched. The
 * title names the game the card changes ("<title> · Dust · Mob Machine"), and the description says
 * it is a change to that game or to this site.
 */
export function withCardMeta(html: string, id: string, meta: CardMeta): string {
  const studioName = STUDIO_NAME;
  const changes = meta.folder === undefined ? undefined : CHANGES[meta.folder];
  const title = changes?.game ? `${meta.title} · ${changes.game} · ${studioName}` : `${meta.title} · ${studioName}`;
  const lead = changes === undefined ? '' : `A change to ${changes.what}.`;
  const description = [lead, meta.summary].filter((part) => part !== '').join(' ');
  const values: [string, string][] = [
    ['property="og:title"', title],
    ['property="og:url"', `${SITE}/card/${id}`],
    ['property="og:image"', `${SITE}/api/card/${id}/preview.png`],
    ['property="og:image:alt"', `${meta.title}: the card's face on ${studioName}`],
  ];
  if (description !== '') {
    values.push(['property="og:description"', description], ['name="description"', description]);
  }
  let out = html;
  for (const [attr, value] of values) {
    out = out.replace(new RegExp(`(<meta ${attr} content=")[^"]*(")`), (_, a: string, b: string) => `${a}${escapeAttr(value)}${b}`);
  }
  // A function, as above: a title holding $' or $& must not be read as a replacement pattern.
  out = out.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeAttr(title)}</title>`);
  return withCanonical(out, `${SITE}/card/${id}`);
}
