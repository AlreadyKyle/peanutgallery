// Formatting for the board's figures, copied from the public site's format.ts so this kernel app
// imports nothing from a folder cards can change.

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

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

/** An amount in another currency, such as the one Stripe settles in: "1,234.56 CAD". */
export function formatAmount(value: number, currency: string): string {
  return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency.toUpperCase()}`;
}

const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const dateOnly = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

// en-GB spells September "Sept"; the studio writes every month in three letters.
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

/** A calendar day given as YYYY-MM-DD, such as a dispute's due date in Stripe. */
export function formatDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? threeLetterMonth(dateOnly, date) : day;
}

const clock = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatClock(date: Date): string {
  return clock.format(date);
}
