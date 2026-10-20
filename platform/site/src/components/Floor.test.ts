import { describe, expect, it } from 'vitest';
import { litStation } from './Floor';

// The rail lights the station the reader has reached, and holds it through what sits between two
// stations (the owner, 18 October 2026: the rail went dark over the first game).
describe('litStation', () => {
  const parts = (fund: number, ideas: number) => [
    { id: 'fund', top: fund },
    { id: 'ideas', top: ideas },
  ];

  it('lights nothing above the first station', () => {
    expect(litStation(parts(500, 1500), 360)).toBeNull();
  });

  it('holds Fund past its foot, over the first game, until Ideas reaches the line', () => {
    expect(litStation(parts(-1200, 900), 360)).toBe('fund');
    expect(litStation(parts(-1900, 360), 360)).toBe('ideas');
  });
});
