import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatDate,
  formatDateTime,
  formatInteger,
  formatPostedAt,
  formatUsd,
  percent,
  shortSha,
  toNumber,
} from './format';

describe('formatUsd', () => {
  it('renders two decimals with a dollar sign and grouping', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(1)).toBe('$1.00');
    expect(formatUsd(0.4856)).toBe('$0.49');
    expect(formatUsd(1234.5)).toBe('$1,234.50');
  });
});

describe('toNumber', () => {
  it('parses the numeric strings PostgREST returns', () => {
    expect(toNumber('12.3400')).toBe(12.34);
    expect(toNumber(7)).toBe(7);
  });

  it('returns null for missing or malformed values', () => {
    expect(toNumber(null)).toBeNull();
    expect(toNumber('')).toBeNull();
    expect(toNumber('   ')).toBeNull();
    expect(toNumber('twelve')).toBeNull();
  });
});

describe('formatInteger', () => {
  it('groups thousands and drops fractions', () => {
    expect(formatInteger(1234567)).toBe('1,234,567');
    expect(formatInteger(12.9)).toBe('13');
  });
});

describe('percent', () => {
  it('clamps between zero and one hundred', () => {
    expect(percent(50, 100)).toBe(50);
    expect(percent(150, 100)).toBe(100);
    expect(percent(-1, 100)).toBe(0);
    expect(percent(5, 0)).toBe(0);
  });
});

describe('shortSha', () => {
  it('keeps the first seven characters', () => {
    expect(shortSha('2775bcb1000a2ebb53a1b03771afb137aae2f50c')).toBe('2775bcb');
  });
});

describe('formatDateTime', () => {
  it('renders day, short month, year and a 24-hour clock', () => {
    expect(formatDateTime('2026-03-05T14:07:00Z')).toBe('5 Mar 2026, 14:07');
    expect(formatDateTime('2026-12-25T00:05:00Z')).toBe('25 Dec 2026, 00:05');
  });

  it('returns the input when it is not a date', () => {
    expect(formatDateTime('yesterday')).toBe('yesterday');
  });
});

describe('formatDate', () => {
  it('renders day, short month and year without a clock', () => {
    expect(formatDate('2026-03-05T14:07:00Z')).toBe('5 Mar 2026');
    expect(formatDate('2026-12-25T00:05:00Z')).toBe('25 Dec 2026');
  });

  it('returns the input when it is not a date', () => {
    expect(formatDate('soon')).toBe('soon');
  });
});

describe('formatClock', () => {
  it('renders hours and minutes on a 24-hour clock', () => {
    expect(formatClock(new Date('2026-03-05T14:07:00Z'))).toBe('14:07');
    expect(formatClock(new Date('2026-03-05T00:05:00Z'))).toBe('00:05');
    expect(formatClock(new Date('2026-03-05T23:59:00Z'))).toBe('23:59');
  });
});

describe('formatPostedAt', () => {
  // The same Toronto time for every reader: vitest runs this file with the process time zone as the
  // machine has it, and the spec's Verification runs it again with TZ=UTC and TZ=Pacific/Auckland.
  it('writes a posted time as a date and clock time in Toronto time', () => {
    expect(formatPostedAt('2026-09-23T01:32:51Z')).toBe('22 Sep 2026 at 21:32 Toronto time');
    expect(formatPostedAt('2026-09-23 01:32:51+00')).toBe('22 Sep 2026 at 21:32 Toronto time');
    expect(formatPostedAt('2027-01-15T17:00:00Z')).toBe('15 Jan 2027 at 12:00 Toronto time');
  });

  it('writes midnight as 00, never 24', () => {
    expect(formatPostedAt('2026-11-02T05:00:00Z')).toBe('2 Nov 2026 at 00:00 Toronto time');
  });

  it('returns what it was given when it is not a time', () => {
    expect(formatPostedAt('not a time')).toBe('not a time');
  });
});
