import { describe, expect, it } from 'vitest';
import { eased, morphShare, morphTransform } from './studio-morph';

const LAYOUT = { bigLeft: 80, bigTop: 140, bigWidth: 700, smallLeft: 64, smallWidth: 312, offset: 0, railTop: 760, stick: 77 };

describe('studio morph', () => {
  it('runs from the top of the page to where the rail sticks', () => {
    const end = LAYOUT.railTop - LAYOUT.stick;
    expect(morphShare(0, LAYOUT.railTop, LAYOUT.stick)).toBe(0);
    expect(morphShare(end / 2, LAYOUT.railTop, LAYOUT.stick)).toBe(0.5);
    expect(morphShare(end, LAYOUT.railTop, LAYOUT.stick)).toBe(1);
    expect(morphShare(end * 3, LAYOUT.railTop, LAYOUT.stick)).toBe(1);
    // A rail that starts stuck has nowhere to run: the room is already landed.
    expect(morphShare(0, 50, 77)).toBe(1);
  });

  it('eases off the top and onto the rail', () => {
    expect(eased(0)).toBe(0);
    expect(eased(0.5)).toBe(0.5);
    expect(eased(1)).toBe(1);
    expect(eased(0.1)).toBeLessThan(0.1);
    expect(eased(0.9)).toBeGreaterThan(0.9);
  });

  it('stands still at the start and lands exactly on the map', () => {
    expect(morphTransform(LAYOUT, 0, 0)).toBe('translate(0.00px, 0.00px) scale(1.0000)');
    const y = LAYOUT.railTop - LAYOUT.stick;
    const [, dx, dy, scale] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(morphTransform(LAYOUT, y, 1))!.map(Number);
    // Landed: the room's left, top and width are the map's, as the map stands on screen now.
    expect(LAYOUT.bigLeft + dx!).toBeCloseTo(LAYOUT.smallLeft, 1);
    expect(LAYOUT.bigTop - y + dy!).toBeCloseTo(LAYOUT.stick + LAYOUT.offset, 1);
    expect(LAYOUT.bigWidth * scale!).toBeCloseTo(LAYOUT.smallWidth, 1);
  });
});
