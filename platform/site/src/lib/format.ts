const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export type Numeric = number | string | null;

export function toNumber(value: Numeric): number | null {
  if (value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatUsd(value: number): string {
  return usd.format(value);
}

export function formatInteger(value: number): string {
  return integer.format(value);
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// en-GB spells September "Sept"; the site writes every month in three letters (DESIGN.md).
function threeLetterMonth(format: Intl.DateTimeFormat, date: Date): string {
  return format
    .formatToParts(date)
    .map((part) => (part.type === 'month' ? part.value.slice(0, 3) : part.value))
    .join('');
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? threeLetterMonth(dateTime, date) : iso;
}

const dateOnly = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const dayUtc = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

/**
 * A calendar day written as YYYY-MM-DD (a hold's New York end date, docs/specs/supporter-pages.md),
 * as that day wherever the reader is: "7 Oct 2026".
 */
export function formatDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date.getTime())) return day;
  return threeLetterMonth(dayUtc, date);
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? threeLetterMonth(dateOnly, date) : iso;
}

const toronto = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Toronto',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * When a Terms version took effect, the same for every reader wherever they are:
 * "22 Sep 2026 at 21:32 Toronto time" (docs/specs/legal-copy.md, Times).
 */
export function formatPostedAt(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  const parts = toronto.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('day')} ${value('month').slice(0, 3)} ${value('year')} at ${value('hour')}:${value('minute')} Toronto time`;
}

const clock = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatClock(date: Date): string {
  return clock.format(date);
}

export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.max(0, Math.min(100, (part / whole) * 100));
}
