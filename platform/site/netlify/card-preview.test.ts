// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// Beside the functions folders, not in them: Netlify deploys every file there.
import { cardIdFrom, metaFrom, STUDIO_NAME, withCardMeta } from './lib/card-meta';
import { clip, draftToLive, face, fundingLine, HEIGHT, previewCardFrom, renderPreview, STAGE_WORDS, stageWord, supporterLine, TOKENS, WIDTH } from './lib/card-preview';

const SITE_DIR = join(__dirname, '..');
const ID = '00000000-0000-4000-8000-000000000004';
const BODY = JSON.stringify({
  card: { id: ID, title: 'A dash for the robot', summary: 'The robot can dash once a second.', stage: 'live', created_at: '2026-10-01T10:00:00Z', live_at: '2026-10-03T12:00:00Z' },
  spent_usd: '12.345',
  supporters: [{ number: 1, founding: true }, { number: 4, founding: false }],
  supporter_count: 2,
});

describe('the preview face', () => {
  it('uses tokens.css colours and copy.ts words', () => {
    const tokens = readFileSync(join(SITE_DIR, 'src/tokens.css'), 'utf8');
    for (const [name, value] of Object.entries(TOKENS)) {
      expect(tokens, name).toMatch(new RegExp(`--${name}: ${value};`));
    }
    const copy = readFileSync(join(SITE_DIR, 'src/lib/copy.ts'), 'utf8');
    expect(copy).toContain(`studioName: '${STUDIO_NAME}'`);
    for (const word of new Set(Object.values(STAGE_WORDS))) expect(copy, word).toContain(`: '${word}'`);
  });

  it("lists supporters by number, never by amount, in the site's words", () => {
    expect(supporterLine([], 0)).toBe('No supporters yet');
    expect(supporterLine([3], 1)).toBe('Funded by Supporter 3');
    expect(supporterLine([1, 4, 9], 3)).toBe('Funded by Supporter 1, 4 and 9');
    expect(supporterLine([1, 2, 3, 4, 5, 6, 7, 8, 9], 30)).toBe('Funded by Supporter 1, 2, 3, 4, 5, 6, 7, 8 and 22 more');
    expect(supporterLine([1204], 1)).toBe('Funded by Supporter 1,204');
  });

  it("says each stage in the site's state words", () => {
    expect(stageWord({ stage: 'proposed', horizon: 'now' })).toBe('Open for funding');
    expect(stageWord({ stage: 'voted', horizon: 'now' })).toBe('Open for funding');
    expect(stageWord({ stage: 'designing', horizon: 'next' })).toBe('Planned');
    expect(stageWord({ stage: 'funded', horizon: 'now' })).toBe('Funded');
    expect(stageWord({ stage: 'gated', horizon: 'now' })).toBe('Being checked');
    expect(stageWord({ stage: 'rejected', horizon: 'now' })).toBe('Not built');
    expect(stageWord({ stage: 'live', horizon: 'now' })).toBe('Live');
  });

  it('shows the funding bar before building starts, and what the agents spent after', () => {
    expect(fundingLine({ fundedUsd: 0.52, targetUsd: 0.78 })).toBe('$0.52 of $0.78 funded');
    expect(fundingLine({ fundedUsd: 0, targetUsd: 0 })).toBeNull();
    const open = previewCardFrom(
      JSON.stringify({
        card: { title: 'Cheaper Carts', summary: 'Carts cost less.', stage: 'proposed', horizon: 'now', funded_usd: 0.4, funding_target_usd: 0.78, created_at: '2026-10-01T10:00:00Z' },
        funding: { credited_usd: 0.52 },
        spent_usd: 0.28,
        supporters: [{ number: 1, founding: true }],
        supporter_count: 1,
      }),
    )!;
    const openText = JSON.stringify(face(open));
    expect(openText).toContain('$0.52 of $0.78 funded');
    expect(openText).toContain('Open for funding');
    expect(openText).toContain('Funded by Supporter 1');
    expect(openText).not.toContain('Agents spent');
    expect(openText).not.toContain('$0.28');
    const live = JSON.stringify(face(previewCardFrom(BODY)!));
    expect(live).toContain('Agents spent');
    expect(live).toContain('$12.35');
    expect(live).not.toContain(' funded"');
  });

  it('gives draft to live only once a card is live', () => {
    expect(draftToLive('2026-10-01T10:00:00Z', null)).toBeNull();
    expect(draftToLive('2026-10-01T10:00:00Z', '2026-10-01T10:20:00Z')).toBe('1 hour');
    expect(draftToLive('2026-10-01T10:00:00Z', '2026-10-01T15:00:00Z')).toBe('5 hours');
    expect(draftToLive('2026-10-01T10:00:00Z', '2026-10-03T12:00:00Z')).toBe('2 days');
    expect(draftToLive('2026-10-03T10:00:00Z', '2026-10-01T10:00:00Z')).toBeNull();
  });

  it('reads site_card and refuses a body with no card', () => {
    expect(previewCardFrom(BODY)).toMatchObject({ title: 'A dash for the robot', spentUsd: 12.345, supporters: [1, 4], supporterCount: 2, fundedUsd: 0, targetUsd: 0 });
    expect(previewCardFrom('{"card":null}')).toBeNull();
    expect(previewCardFrom('[]')).toBeNull();
  });

  it('draws a 1200x630 PNG', async () => {
    const png = Buffer.from(await renderPreview(previewCardFrom(BODY)!));
    expect(png.toString('ascii', 1, 4)).toBe('PNG');
    expect(png.toString('ascii', 12, 16)).toBe('IHDR');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([WIDTH, HEIGHT]);
  }, 30_000);
});

describe('the card page tags', () => {
  const html = readFileSync(join(SITE_DIR, 'index.html'), 'utf8');

  it('takes only a uuid card path', () => {
    expect(cardIdFrom(`/card/${ID.toUpperCase()}`)).toBe(ID);
    expect(cardIdFrom(`/card/${ID}/`)).toBe(ID);
    expect(cardIdFrom('/card/nope')).toBeNull();
    expect(cardIdFrom(`/card/${ID}/more`)).toBeNull();
  });

  it('names the card, its address and its preview, escaped', () => {
    const meta = metaFrom(JSON.stringify({ card: { title: 'Fish & "chips" <b>', summary: 'Crisp.' } }))!;
    const out = withCardMeta(html, ID, meta);
    expect(out).toContain(`<meta property="og:image" content="https://mobmachine.games/api/card/${ID}/preview.png" />`);
    expect(out).toContain(`<meta property="og:url" content="https://mobmachine.games/card/${ID}" />`);
    expect(out).toContain('<meta property="og:title" content="Fish &amp; &quot;chips&quot; &lt;b&gt; · Mob Machine" />');
    expect(out).toContain('<meta property="og:description" content="Crisp." />');
    expect(out).toContain('<title>Fish &amp; &quot;chips&quot; &lt;b&gt; · Mob Machine</title>');
    expect(out).toContain('<meta property="og:image:width" content="1200" />');
  });

  it('names the game a card changes, or this site', () => {
    const dust = withCardMeta(html, ID, metaFrom(JSON.stringify({ card: { title: 'Cheaper Carts', summary: 'Carts cost less.', folder: 'seed-1' } }))!);
    expect(dust).toContain('<title>Cheaper Carts · Dust · Mob Machine</title>');
    expect(dust).toContain('<meta property="og:title" content="Cheaper Carts · Dust · Mob Machine" />');
    expect(dust).toContain('<meta property="og:description" content="A change to Dust. Carts cost less." />');
    expect(dust).toContain('<meta name="description" content="A change to Dust. Carts cost less." />');
    const site = withCardMeta(html, ID, { title: 'A clearer ledger', summary: '', folder: 'platform' });
    expect(site).toContain('<title>A clearer ledger · Mob Machine</title>');
    expect(site).toContain('<meta property="og:description" content="A change to this site." />');
  });

  it('writes a title holding $ replacement patterns as it is, once', () => {
    const title = "Win $' and $& and $` and $$5";
    const out = withCardMeta(html, ID, { title, summary: 'Crisp $\' too.' });
    const shown = "Win $' and $&amp; and $` and $$5";
    expect(out).toContain(`<title>${shown} · Mob Machine</title>`);
    expect(out).toContain(`<meta property="og:title" content="${shown} · Mob Machine" />`);
    expect(out).toContain(`<meta property="og:description" content="Crisp $' too." />`);
    expect(out.match(/<title>/g)).toHaveLength(1);
    expect(out.match(/<\/html>/g)).toHaveLength(1);
  });

  it('refuses a body with no title', () => {
    expect(metaFrom('{"card":{"title":""}}')).toBeNull();
    expect(metaFrom('not json')).toBeNull();
  });
});

describe('clip', () => {
  it('cuts on a character, never inside a surrogate pair', () => {
    const out = clip(`${'a'.repeat(68)}🚀🚀🚀`, 70);
    expect(out).toBe(`${'a'.repeat(68)}…`);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out)).toBe(false);
    expect(clip('short  title', 70)).toBe('short title');
  });
});
