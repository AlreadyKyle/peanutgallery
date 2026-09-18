import { describe, expect, it } from 'vitest';
import { copy } from './copy';

// docs/COPY.md is the copy guide; these tests keep every public string to the rules it marks tested.

function strings(value: unknown, path: string, out: Array<[string, string]>): Array<[string, string]> {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((item, i) => strings(item, `${path}[${i}]`, out));
  else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) strings(item, path === '' ? key : `${path}.${key}`, out);
  }
  return out;
}

const all = strings(copy, '', []);

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
      copy.split,
      copy.fundIntro,
      copy.queuedIntro,
      copy.shippedIntro,
      ...copy.steps,
      copy.artPolicy,
      copy.allAges,
      copy.fixedRulesIntro,
      ...copy.fixedRules,
      copy.footer,
    ];
    const inside = /\b(default split|the gate|kernel|dispatcher|directive|lane|the pool)\b/i;
    expect(landing.filter((t) => inside.test(t))).toEqual([]);
  });
});
