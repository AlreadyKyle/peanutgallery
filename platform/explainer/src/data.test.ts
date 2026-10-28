import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { copy } from '../../site/src/lib/copy';
import { legal } from '../../site/src/lib/legal';
import { hand, HERO, roster, shipped, stepHeadings } from './data';

// The video makes no claim the site does not: its first and last lines are the board's own (PLAN.md
// §10 decision 57), every line between is a sentence the site already says, word for word, and every
// agent is a running role from its spec. It names no game.

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe("the video's words", () => {
  const { explainer, ...rest } = legal;
  const site = [...strings(copy), ...strings(rest)];

  it('says only sentences the site already says, between the board\'s opening and closing lines', () => {
    for (const beat of explainer.beats.slice(1, -1)) {
      expect(site.some((text) => text.includes(beat.line)), beat.line).toBe(true);
    }
  });

  it('names steps of /how-it-works, in their order', () => {
    const steps = explainer.beats.flatMap((beat) => (beat.step === null ? [] : [beat.step]));
    expect(steps.length).toBeGreaterThan(0);
    const at = steps.map((step) => stepHeadings.indexOf(step));
    expect(at.every((i) => i >= 0), steps.join(', ')).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("opens and closes on the board's lines for the video (PLAN.md §10 decision 57)", () => {
    expect(explainer.beats[0]!.line).toBe('Watch AI agents build a game studio and free games.');
    expect(explainer.beats[explainer.beats.length - 1]!.line).toBe('Fund a card. Watch AI agents build it. Play it free.');
  });

  it('names no game, in its words or on its cards', () => {
    const shown = [...explainer.beats.map((beat) => beat.line), ...hand, ...shipped];
    expect(shown.filter((text) => /\bdust\b/i.test(text))).toEqual([]);
  });
});

describe("the video's cast and cards", () => {
  it('draws every running agent and no other', () => {
    const dir = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'agents');
    const running = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as { title: string; status: string })
      .filter((role) => role.status === 'running')
      .map((role) => role.title);
    expect(roster.map((agent) => agent.title).sort()).toEqual(running.sort());
  });

  it('follows one card from a hand of four, onto a pile of three', () => {
    expect(hand).toHaveLength(4);
    expect(new Set(hand).size).toBe(4);
    expect(hand[HERO]).toBe('Show how long until the next unlock');
    expect(shipped).toHaveLength(3);
  });
});
