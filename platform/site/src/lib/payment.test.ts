import { describe, expect, it } from 'vitest';
import { exampleSplit, fundLink, MIN_AMOUNT_USD, prefilledCents, snapStudioPct, splitReference, STUDIO_PCT_STEPS } from './payment';

// The slider's reference (docs/specs/split-slider.md), which the webhook's parseReference reads
// (platform/supabase/functions/_shared/split.ts).
const BASE = 'https://buy.stripe.com/test-link';
const CARD = '6f1d2c3b-4a5e-4f60-8b71-9c2d3e4f5a6b';

describe('split slider links', () => {
  it('stops at the eleven splits the webhook allows', () => {
    expect(STUDIO_PCT_STEPS).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect([snapStudioPct(24), snapStudioPct(25), snapStudioPct(-5), snapStudioPct(130), snapStudioPct(Number.NaN)]).toEqual([20, 30, 0, 100, 20]);
  });

  it('writes the card id, then split and the studio percent, within Stripe\'s 200 characters', () => {
    expect(splitReference(CARD, 30)).toBe(`${CARD}_split30`);
    expect(splitReference(null, 0)).toBe('split0');
    expect(splitReference(CARD)).toBe(CARD);
    expect(splitReference(null)).toBeNull();
    for (const pct of STUDIO_PCT_STEPS) expect(splitReference(CARD, pct)!.length).toBeLessThanOrEqual(200);
  });

  it('adds client_reference_id to the Payment Link, and leaves the link bare with neither', () => {
    expect(fundLink(BASE, CARD, 70)).toBe(`${BASE}?client_reference_id=${CARD}_split70`);
    expect(fundLink(BASE, null, 20)).toBe(`${BASE}?client_reference_id=split20`);
    expect(fundLink(BASE, CARD)).toBe(`${BASE}?client_reference_id=${CARD}`);
    expect(fundLink(BASE, null)).toBe(BASE);
    expect(fundLink(`${BASE}?prefilled_email=x`, null, 20)).toBe(`${BASE}?prefilled_email=x&client_reference_id=split20`);
  });

  // The Machine card's presets (docs/specs/machine-presets.md): Stripe's prefilled_amount, in cents.
  it('adds the amount checkout opens on in cents after the reference, from the $2 minimum', () => {
    expect(fundLink(BASE, null, 20, 10)).toBe(`${BASE}?client_reference_id=split20&prefilled_amount=1000`);
    expect(fundLink(BASE, null, undefined, 5)).toBe(`${BASE}?prefilled_amount=500`);
    expect(fundLink(BASE, CARD, 70, 100)).toBe(`${BASE}?client_reference_id=${CARD}_split70&prefilled_amount=10000`);
    expect(fundLink(`${BASE}?locale=en`, null, undefined, 25)).toBe(`${BASE}?locale=en&prefilled_amount=2500`);
    expect(MIN_AMOUNT_USD).toBe(2);
    expect(fundLink(BASE, null, 20, MIN_AMOUNT_USD)).toBe(`${BASE}?client_reference_id=split20&prefilled_amount=200`);
    for (const bad of [1.99, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(fundLink(BASE, null, 20, bad)).toBe(`${BASE}?client_reference_id=split20`);
    expect(fundLink(BASE, null, undefined, 1)).toBe(BASE);
    expect([prefilledCents(12.34), prefilledCents(2.5), prefilledCents(undefined)]).toEqual([1234, 250, null]);
  });

  it('works the example split at any allowed studio percent, the reserve fixed', () => {
    expect(exampleSplit(10)).toMatchObject({ reserve: 1, studio: 1.8, agents: 7.2 });
    expect(exampleSplit(10, 50)).toMatchObject({ reserve: 1, studio: 4.5, agents: 4.5 });
  });
});
