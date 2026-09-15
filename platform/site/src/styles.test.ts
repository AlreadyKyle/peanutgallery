import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// BRAND.md is the style guide; these tests keep the stylesheet to it.
// jsdom gives import.meta.url an http scheme, so resolve from the package root vitest runs in.
const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
const SIZES = ['--size-small', '--size-body', '--size-lead', '--size-large', '--size-display'];

function rem(token: string): number {
  const match = css.match(new RegExp(`${token}:\\s*([0-9.]+)rem`));
  if (!match) throw new Error(`${token} is not defined`);
  return Number(match[1]);
}

function hex(token: string): string {
  const match = css.match(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`${token} is not a six-digit hex colour`);
  return match[1]!;
}

// WCAG 2.x relative luminance and contrast ratio.
function luminance(colour: string): number {
  const channel = (i: number) => {
    const c = parseInt(colour.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** Each rule as its selector and its body, comments removed. */
function rules(): { selector: string; body: string }[] {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]! }));
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
});

describe('plain and readable', () => {
  it('uses italic and uppercase only on the wordmark', () => {
    const styled = rules()
      .filter((rule) => /font-style:\s*italic|text-transform:\s*uppercase/.test(rule.body))
      .map((rule) => rule.selector);
    expect(styled).toEqual(['.wordmark']);
  });

  it('never uses the 900 display weight or letter-spacing', () => {
    expect(css).not.toMatch(/font-weight:\s*900|--weight-display|letter-spacing/);
  });

  it('keeps body and secondary text at WCAG AA contrast or better on the page ground', () => {
    const paper = hex('--paper');
    expect(contrast(hex('--ink'), paper)).toBeGreaterThanOrEqual(7);
    expect(contrast(hex('--muted'), paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex('--paper'), hex('--ink-hover'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex('--field'), paper)).toBeGreaterThanOrEqual(3);
  });

  it('writes colours as tokens outside :root', () => {
    const outside = rules()
      .filter((rule) => rule.selector !== ':root')
      .filter((rule) => /#[0-9a-fA-F]{3,6}\b/.test(rule.body))
      .map((rule) => rule.selector);
    expect(outside).toEqual([]);
  });

  it('gives buttons, nav links and fields the 44px touch target', () => {
    expect(css).toMatch(/--target:\s*2\.75rem/);
    for (const selector of ['.button,\nbutton', 'nav a', 'input,\nselect,\ntextarea']) {
      const rule = rules().find((r) => r.selector === selector);
      expect(rule?.body, selector).toContain('min-height: var(--target)');
    }
  });
});
