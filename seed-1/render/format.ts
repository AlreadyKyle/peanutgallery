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

export function formatDuration(seconds: number): string {
  const total = Math.max(1, Math.ceil(seconds));
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${total % 60}s`;
  return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
}

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
