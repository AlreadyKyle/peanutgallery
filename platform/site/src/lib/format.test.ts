import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatDate,
  formatDateTime,
  formatInteger,
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
