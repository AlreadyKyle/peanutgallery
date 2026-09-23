import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copy } from './copy';
import { legal } from './legal';

// docs/COPY.md is the copy guide; these tests keep every public string to the rules it marks tested.

function strings(value: unknown, path: string, out: Array<[string, string]>): Array<[string, string]> {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((item, i) => strings(item, `${path}[${i}]`, out));
  else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) strings(item, path === '' ? key : `${path}.${key}`, out);
  }
  return out;
}

// Every public string: the site's words in copy.ts and the legal pages and money statements in legal.ts.
const all = [...strings(copy, 'copy', []), ...strings(legal, 'legal', [])];

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
    const landing = [
      copy.pitchTitle,
      copy.pitchBody,
      legal.split,
      copy.fundIntro,
      copy.queuedIntro,
      copy.shippedIntro,
      ...copy.steps,
      copy.howItWorksMore,
      legal.pausedNotice,
      copy.nowEmptyPaused,
      legal.artPolicy,
      legal.allAges,
      legal.fixedRulesIntro,
      ...legal.fixedRules,
      copy.footer,
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

  it('labels the pool figure In the pool and never promises money can be spent now', () => {
    expect(legal.poolBalance).toBe('In the pool');
    expect(legal.describeAvailable).not.toMatch(/\bnow\b/i);
    expect(legal.shortfall).toContain('{amount}');
  });

  it('names both hold triggers wherever a hold is described', () => {
    const large = legal.terms.sections.find((section) => section.heading === 'Large contributions')?.paragraphs.join(' ') ?? '';
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
    expect(legal.legalUpdated).toBe('Last updated 22 September 2026.');
  });

  it('describes no founding contributions, gate or player decision', () => {
    expect(copy.notLiveYet).not.toMatch(/founding/i);
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

describe('copy.ts and legal.ts (docs/specs/board-site.md)', () => {
  it('share no key, so every money statement is read from legal.ts', () => {
    expect(Object.keys(copy).filter((key) => key in legal)).toEqual([]);
  });
});
