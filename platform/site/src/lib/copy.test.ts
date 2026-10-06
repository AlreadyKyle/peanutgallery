import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copy } from './copy';
import { legal } from './legal';
import { NEWEST_TERMS, TERMS_VERSIONS } from './terms-versions';

// docs/COPY.md is the copy guide; these tests keep every public string to the rules it marks tested.

function strings(value: unknown, path: string, out: Array<[string, string]>): Array<[string, string]> {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((item, i) => strings(item, `${path}[${i}]`, out));
  else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) strings(item, path === '' ? key : `${path}.${key}`, out);
  }
  return out;
}

// Every public string the rules apply to: the site's words in copy.ts, the legal pages and money
// statements in legal.ts, and the newest Terms version. An older version was checked when it was
// written, and a later rule never forces an edit to posted words (docs/specs/legal-copy.md).
const all = [
  ...strings(copy, 'copy', []),
  ...strings(legal, 'legal', []),
  ...strings(NEWEST_TERMS, `terms-v${NEWEST_TERMS.version}`, []),
];

// The one contrast the guide allows: the legal line about contributions.
const ALLOWED_CONTRAST = 'These are contributions, not donations.';

// Keys whose strings are labels, verbs or templates rather than sentences.
function sentences(text: string): string[] {
  return text
    .replace(ALLOWED_CONTRAST, '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => /[.!?]$/.test(s));
}

function offenders(test: (text: string) => boolean): string[] {
  return all.filter(([, text]) => test(text)).map(([path, text]) => `${path}: ${text}`);
}

describe('copy rules', () => {
  it('has no "X is your Y" aphorisms', () => {
    expect(offenders((t) => /\b(is|are) your\b/i.test(t))).toEqual([]);
  });

  it('has no "X, never Y" or "X, not Y" contrasts beyond the contributions line', () => {
    expect(offenders((t) => /, (never|not) \w/i.test(t.replace(ALLOWED_CONTRAST, '')))).toEqual([]);
  });

  it('has no sentence under three words', () => {
    expect(
      offenders((t) => sentences(t).length > 1 && sentences(t).some((s) => s.split(/\s+/).length < 3)),
    ).toEqual([]);
  });

  it('does not repeat an opening word for rhythm', () => {
    expect(offenders((t) => /\b(every|all)\b[^.]*,\s*\1\b[^.]*\b\1\b/i.test(t))).toEqual([]);
  });

  it('has no em dashes', () => {
    expect(offenders((t) => t.includes('—'))).toEqual([]);
  });

  it('has no inflated words', () => {
    const inflated =
      /\b(seamless|powerful|unlock your|journey|reimagine|revolutionary|cutting-edge|testament|landscape|elevate|empower)/i;
    expect(offenders((t) => inflated.test(t))).toEqual([]);
  });

  it('keeps inside terms off the landing page', () => {
    // What home renders (docs/specs/home-and-design.md): the pitch, the status line, the updates row,
    // the section headings and intros, the empty lines, the split and the footer. Figure labels
    // (In the pool, with its description under it) are not sentences and are not listed.
    const landing = [
      copy.pitchTitle,
      copy.pitchBody,
      copy.playFree,
      copy.howItWorks,
      ...Object.values(copy.status.open),
      copy.status.openNone,
      ...Object.values(copy.status.building),
      copy.now,
      copy.fund,
      copy.fundIntro,
      copy.showAllCards,
      copy.queued,
      copy.queuedIntro,
      copy.queuedEmpty,
      copy.team.title,
      copy.shipped,
      copy.plannedNext,
      copy.roadmapLink,
      legal.fundAgreement,
      legal.moneyHeading,
      legal.splitLine,
      legal.notDonations,
      legal.latestActions,
      copy.fullLedger,
      copy.footer,
      legal.allAges,
      legal.explainer.play,
      ...legal.explainer.beats.flatMap((beat) => [beat.line, ...(beat.step === null ? [] : [beat.step])]),
    ];
    const inside = /\b(default split|the gate|kernel|dispatcher|directive|lane|the pool)\b/i;
    expect(landing.filter((t) => inside.test(t))).toEqual([]);
  });
});

/** Every non-test source file under a folder, as [path, text]. */
function sourceFiles(dir: string): [string, string][] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx|css|html)$/.test(name) || /\.test\./.test(name)) return [];
    return [[path, readFileSync(path, 'utf8')] as [string, string]];
  });
}

describe('funding a card is the choice (22 September 2026)', () => {
  // The stage id 'voted' is not a user-facing word, and the regex does not match it. Planned backlog
  // cards on /roadmap may name planned voting mechanics; they come from the database, not from here.
  const VOTE = /\bvot(e|es|ing|ers?)\b/i;

  it('says vote nowhere in the site source or index.html', () => {
    const root = process.cwd();
    const index = resolve(root, 'index.html');
    const files: [string, string][] = [...sourceFiles(resolve(root, 'src')), [index, readFileSync(index, 'utf8')]];
    const offenders = files.flatMap(([path, text]) =>
      text
        .split('\n')
        .map((line, i) => [line, i] as const)
        .filter(([line]) => VOTE.test(line))
        .map(([line, i]) => `${relative(root, path)}:${i + 1}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });

  it('pitches funding the card you want built next', () => {
    expect(copy.pitchBody).toBe('Fund the card you want built next.');
  });
});

describe('launch copy', () => {
  it('states the art policy for the games and the avatars on one line', () => {
    expect(legal.artPolicy).toBe('Art in the games and the agent avatars is drawn by code.');
    expect(legal.artPolicy).not.toMatch(/such as agent avatars|image model/i);
  });

  it('writes the footer as a full sentence', () => {
    expect(copy.footer).toBe('AI agents build free games you can play in a browser.');
  });

  it('pitches free games and names no game on home (PLAN.md §10 decision 58)', () => {
    expect(copy.pitchTitle).toBe('Watch AI agents build a game studio and free games.');
    expect(legal.explainer.beats[0]!.line).toBe(copy.pitchTitle);
    const index = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    expect(index).not.toMatch(/\bDust\b/);
    for (const text of [copy.pitchTitle, copy.pitchBody, copy.footer, copy.fundIntro, copy.playFree, copy.categories.game, copy.categoryNotes.game]) {
      expect(text).not.toMatch(/\bDust\b/);
    }
  });

  it('labels the pool figure In the pool and never promises money can be spent now', () => {
    expect(legal.poolBalance).toBe('In the pool');
    expect(legal.describeAvailable).not.toMatch(/\bnow\b/i);
    expect(legal.shortfall).toContain('{amount}');
  });

  it('names both hold triggers wherever a hold is described', () => {
    const large = NEWEST_TERMS.terms.sections.find((section) => section.heading === 'Large contributions')?.paragraphs.join(' ') ?? '';
    const holds = legal.howMoneyMoves.sections.find((section) => section.heading === 'Holds and refunds')?.paragraphs[0] ?? '';
    const bar = legal.howMoneyMoves.blocks.find((block) => block.heading === 'The bar fills')?.body[0] ?? '';
    for (const text of [legal.describeHeld, large, holds, bar]) {
      expect(text).toMatch(/\$50/);
      expect(text).toMatch(/studio's (total for the day is under its )?daily limit/);
      expect(text).toMatch(/14 days/);
    }
  });

  it("says money beyond a card's cost pays for later cards", () => {
    const bar = legal.howMoneyMoves.blocks.find((block) => block.heading === 'The bar fills')?.body.join(' ') ?? '';
    expect(bar).toMatch(/rest pays for later cards/);
  });

  it('discloses the card fingerprint hash on the Privacy page and dates the change', () => {
    const stores = legal.privacy.sections.find((section) => section.heading === 'What the studio stores')?.paragraphs.join(' ') ?? '';
    expect(stores).toMatch(/one-way hash of the identifier Stripe gives your payment card/);
    expect(stores).toMatch(/used only to apply the \$50 daily limit/);
    expect(legal.privacyUpdated).toMatch(/^Last updated \d{1,2} [A-Z][a-z]+ \d{4}\.$/);
  });

  it('describes no founding contributions, gate or player decision', () => {
    expect(copy.statusGated).not.toMatch(/gate/i);
    expect(JSON.stringify(copy.sources)).not.toMatch(/decision/i);
  });

  it('gives /how-it-works six steps and headed sections, not questions', () => {
    expect(legal.howMoneyMoves.blocks).toHaveLength(6);
    const headings = [
      ...legal.howMoneyMoves.blocks.map((block) => block.heading),
      ...legal.howMoneyMoves.sections.map((section) => section.heading),
      copy.howItWorksPage.rulesHeading,
    ];
    expect(headings.filter((heading) => heading.includes('?'))).toEqual([]);
    expect(copy.howItWorksPage.exampleReal.startsWith('Example')).toBe(true);
    expect(copy.howItWorksPage.exampleMadeUp.startsWith('Example')).toBe(true);
  });
});

describe('voice (docs/COPY.md, Voice)', () => {
  it('never makes coins a currency: no coin counts, balances or buying', () => {
    const currency = /\b\d[\d,.]*\+?\s*coins?\b|\bcoins?\s+(balance|left|remaining|to spend)\b|\bbuy(ing)?\s+(\w+\s+)?coins?\b|\bin coins\b/i;
    expect(offenders((t) => currency.test(t))).toEqual([]);
  });

  it('puts no chance words beside money: every money and /contribute string', () => {
    const chance = /\b(luck|lucky|mystery|surprise|random|spin|jackpot|bet|odds|prize|loot|win|winner|gamble|chance)\b/i;
    const money = /\$|\bmoney\b|\bfund|\bcontribut|\bcoin|\bpool\b|\bspent\b|\bcheckout\b/i;
    const moneyStrings = all.filter(([path, text]) => path.startsWith('legal') || money.test(text));
    expect(moneyStrings.length).toBeGreaterThan(20);
    expect(moneyStrings.filter(([, text]) => chance.test(text)).map(([path, text]) => `${path}: ${text}`)).toEqual([]);
  });

  it('writes money out with the minus sign (U+2212) and no space, never a hyphen before a dollar figure', () => {
    expect(offenders((t) => /(^|[\s(])-\s?\$\d/.test(t))).toEqual([]);
    expect(offenders((t) => /−(?!\$\d)/.test(t))).toEqual([]);
  });

  it('uses only characters inside the font subset that scripts/fonts.sh cuts', () => {
    const script = readFileSync(resolve(process.cwd(), 'scripts/fonts.sh'), 'utf8');
    const ranges = (/^UNICODES='([^']+)'/m.exec(script)?.[1] ?? '')
      .split(',')
      .map((range) => range.replace(/^U\+/, '').split('-').map((hex) => parseInt(hex, 16)))
      .map(([from, to]) => [from!, to ?? from!] as const);
    expect(ranges).toEqual([
      [0x20, 0x7e],
      [0xa0, 0xff],
      [0x2010, 0x2027],
      [0x2212, 0x2212],
    ]);
    const outside = all.flatMap(([path, text]) =>
      [...text]
        .filter((ch) => !ranges.some(([from, to]) => ch.codePointAt(0)! >= from && ch.codePointAt(0)! <= to))
        .map((ch) => `${path}: U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`),
    );
    expect(outside).toEqual([]);
  });

  it('calls a game by its name, never a numbered cartridge', () => {
    expect(offenders((t) => /\bcartridge\s*\d/i.test(t))).toEqual([]);
  });
});

describe('copy.ts and legal.ts (docs/specs/board-site.md)', () => {
  it('share no key, so every money statement is read from legal.ts', () => {
    expect(Object.keys(copy).filter((key) => key in legal)).toEqual([]);
  });
});

/** Every paragraph of one text page, joined, with each heading before its paragraphs. */
function pageText(page: { sections: readonly { heading: string; paragraphs: readonly string[] }[] }): string {
  return page.sections.map((section) => [section.heading, ...section.paragraphs].join(' ')).join(' ');
}

function section(page: { sections: readonly { heading: string; paragraphs: readonly string[] }[] }, heading: string): string {
  return page.sections.find((candidate) => candidate.heading === heading)?.paragraphs.join(' ') ?? '';
}

describe('the Terms and the Refunds page in force (docs/specs/legal-copy.md)', () => {
  const terms = pageText(NEWEST_TERMS.terms);
  const refunds = pageText(NEWEST_TERMS.refunds);

  it('numbers the versions from 1, oldest first, with no gap and no repeat', () => {
    expect(TERMS_VERSIONS.map((entry) => entry.version)).toEqual(TERMS_VERSIONS.map((_, index) => index + 1));
    expect(NEWEST_TERMS).toBe(TERMS_VERSIONS[TERMS_VERSIONS.length - 1]);
  });

  it('makes version 3 version 2 with the studio renamed Mob Machine and nothing else (docs/specs/rename.md)', () => {
    const [, two, three] = TERMS_VERSIONS;
    const oldName = section(two!.terms, 'Who runs the studio').split(' is operated by')[0]!;
    expect(oldName).not.toBe(copy.studioName);
    const renamed = JSON.parse(JSON.stringify({ terms: two!.terms, refunds: two!.refunds }).replaceAll(oldName, copy.studioName));
    expect({ terms: three!.terms, refunds: three!.refunds }).toEqual(renamed);
    expect(JSON.stringify(three)).not.toContain(oldName);
  });

  it("names the operator and how to reach them", () => {
    expect(section(NEWEST_TERMS.terms, 'Who runs the studio')).toMatch(/^Mob Machine is operated by Kyle Smith, an individual in Ontario, Canada\. Write to \{email\}/);
  });

  it('states who may contribute: an adult, or with a parent or guardian', () => {
    expect(section(NEWEST_TERMS.terms, 'Who can contribute')).toContain(
      'To contribute you must be an adult where you live, or have the permission of a parent or guardian.',
    );
  });

  it('charges in US dollars and adds no tax', () => {
    const price = section(NEWEST_TERMS.terms, 'Price and currency');
    expect(price).toContain('charged in US dollars');
    expect(price).toContain('the studio adds no tax or other charge');
  });

  it('refunds the full amount within 14 days, and another way when Stripe cannot', () => {
    expect(section(NEWEST_TERMS.refunds, 'Asking for a refund')).toMatch(/within 14 days of your contribution.*You get back the full amount you paid\./);
    expect(section(NEWEST_TERMS.refunds, 'How refunds are paid')).toContain(
      'If Stripe cannot refund a payment, for example because the card has been closed, the studio returns the money another way agreed with you by email.',
    );
  });

  it('winds down per contribution: its own share of each bar it reached, the reserves after 120 days, never the studio share', () => {
    const stops = section(NEWEST_TERMS.terms, 'If the studio stops');
    for (const phrase of [
      'its credit still on hold',
      'its share of what is left on each card bar it reached',
      "its share of the agents' unspent money that is on no card's bar",
      '120 days',
      "The studio's share is not refunded.",
      'could not be returned',
    ]) {
      expect(stops, phrase).toContain(phrase);
    }
  });

  it('says a card that is not built pays for later cards, and the 14-day refund still stands', () => {
    expect(section(NEWEST_TERMS.terms, 'If a card is not built')).toMatch(/pays for later cards\. You can still ask for a refund within 14 days/);
    expect(section(NEWEST_TERMS.refunds, 'A card that is not built')).toMatch(/pays for later cards\. You can still ask for a refund within 14 days/);
  });

  it('says the studio has no cryptocurrency, coin, token or NFT, and what the drawn coin is', () => {
    const crypto = section(NEWEST_TERMS.terms, 'No cryptocurrency');
    expect(crypto).toMatch(/has no cryptocurrency, crypto coin, token or NFT\./);
    expect(crypto).toContain('The coin drawn on this site is a symbol for money in US dollars.');
  });

  it('applies a change only to contributions made after it is posted', () => {
    expect(section(NEWEST_TERMS.terms, 'Changes to these terms')).toContain('A change applies only to contributions made after it is posted.');
  });

  it('keeps every link token one the text pages turn into a link', () => {
    const tokens = [...`${terms} ${refunds}`.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
    expect(new Set(tokens)).toEqual(new Set(['email', 'refunds', 'terms']));
  });

  it('states the agreement before checkout with both pages and the age condition', () => {
    for (const line of [legal.contributeAgreement, legal.fundAgreement]) {
      expect(line).toContain('{terms}');
      expect(line).toContain('{refunds}');
      expect(line).toMatch(/adult/);
      expect(line).toMatch(/guardian/);
    }
  });
});

describe('no display name (docs/specs/legal-copy.md)', () => {
  it('no public string says display name, and Privacy says the name stays with Stripe', () => {
    const every = [...all, ...TERMS_VERSIONS.flatMap((entry) => strings(entry, `terms-v${entry.version}`, []))];
    expect(every.filter(([, text]) => /display name/i.test(text)).map(([path]) => path)).toEqual([]);
    expect(section(legal.privacy, 'What the studio stores')).toContain(
      "The studio's database does not store your name. Stripe keeps the name on your card with its record of the payment.",
    );
  });
});
