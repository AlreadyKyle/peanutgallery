import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The type scale is a rule, not a suggestion: five named sizes on a 1.2 ratio from the body,
// and every font-size in the stylesheet uses one of them (code alone scales relative to its text).
// jsdom gives import.meta.url an http scheme, so resolve from the package root vitest runs in.
const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
const SIZES = ['--size-small', '--size-body', '--size-lead', '--size-large', '--size-display'];

function rem(token: string): number {
  const match = css.match(new RegExp(`${token}:\\s*([0-9.]+)rem`));
  if (!match) throw new Error(`${token} is not defined`);
  return Number(match[1]);
}

describe('type scale', () => {
  it('defines exactly the five sizes, in increasing order', () => {
    const defined = [...css.matchAll(/(--size-[a-z]+):\s*[0-9.]+rem/g)].map((m) => m[1]);
    expect(defined).toEqual(SIZES);
    const values = SIZES.map(rem);
    for (let i = 1; i < values.length; i += 1) expect(values[i]).toBeGreaterThan(values[i - 1]!);
  });

  it('keeps each step within a 1.2 ratio of its neighbour, rounded to the nearest quarter pixel', () => {
    const values = SIZES.map(rem);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]! / values[i - 1]!).toBeGreaterThan(1.15);
      expect(values[i]! / values[i - 1]!).toBeLessThan(1.26);
    }
  });

  it('sets every font-size from a size token', () => {
    const declarations = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    const stray = declarations.filter((value) => !/^var\(--size-(small|body|lead|large|display)\)$/.test(value) && value !== '0.9em');
    expect(stray).toEqual([]);
  });

  it('gives the pitch and the launch line the same size', () => {
    expect(css).toMatch(/\.pitch,\s*\.launch\s*\{\s*font-size:\s*var\(--size-lead\);/);
  });
});
