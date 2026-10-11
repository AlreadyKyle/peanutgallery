// Number formatting for the screen. No locale calls, so every viewer sees
// the same digits.

const SUFFIXES: ReadonlyArray<{ value: number; suffix: string }> = [
  { value: 1e12, suffix: 'T' },
  { value: 1e9, suffix: 'B' },
  { value: 1e6, suffix: 'M' },
];

export function groupThousands(whole: number): string {
  const digits = Math.floor(whole).toString();
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    const fromEnd = digits.length - i;
    if (i > 0 && fromEnd % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return out;
}

export function formatDust(amount: number): string {
  for (const entry of SUFFIXES) {
    if (amount >= entry.value) return `${(amount / entry.value).toFixed(2)}${entry.suffix}`;
  }
  return groupThousands(amount);
}

export function formatRate(perSecond: number): string {
  if (perSecond >= 1e6) return formatDust(perSecond);
  if (perSecond >= 100) return groupThousands(perSecond);
  return perSecond.toFixed(1);
}

export function formatPercent(multiplier: number): string {
  return `${Math.round((multiplier - 1) * 100)}%`;
}

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/** A span of time away, coarse on purpose: "12m", "2h 14m". */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
