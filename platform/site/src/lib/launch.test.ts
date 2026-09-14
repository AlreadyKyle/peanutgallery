import { describe, expect, it } from 'vitest';
import { copy } from './copy';
import { launchLine } from './launch';

describe('launchLine', () => {
  it('uses the board announcement line when no date is set', () => {
    expect(launchLine('')).toBe(copy.launchDefault);
    expect(launchLine('   ')).toBe(copy.launchDefault);
  });

  it('falls back to the announcement line when the value is not a date', () => {
    expect(launchLine('next monday')).toBe(copy.launchDefault);
  });

  it('formats an ISO instant in Eastern time', () => {
    expect(launchLine('2026-10-05T14:00:00Z')).toBe('Launch: Monday 5 October 2026, 10:00 ET');
  });

  it('applies standard time in winter', () => {
    expect(launchLine('2026-12-07T15:00:00Z')).toBe('Launch: Monday 7 December 2026, 10:00 ET');
  });
});
