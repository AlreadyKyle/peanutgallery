import { copy } from './copy';

const eastern = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? '';
}

export function launchLine(launchAt: string): string {
  const value = launchAt.trim();
  if (value === '') return copy.launchDefault;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return copy.launchDefault;
  const parts = eastern.formatToParts(date);
  const day = `${part(parts, 'weekday')} ${part(parts, 'day')} ${part(parts, 'month')} ${part(parts, 'year')}`;
  const time = `${part(parts, 'hour')}:${part(parts, 'minute')}`;
  return `Launch: ${day}, ${time} ET`;
}
