// Number formatting for the screen. No locale calls, so every viewer sees
// the same digits.

// Largest first. Past the last one the figure switches to an exponent ("1.50e21"), so it never grows
// into a run of digits that overflows the canvas.
const SUFFIXES: ReadonlyArray<{ value: number; suffix: string }> = [
  { value: 1e18, suffix: 'Qi' },
  { value: 1e15, suffix: 'Qa' },
  { value: 1e12, suffix: 'T' },
  { value: 1e9, suffix: 'B' },
  { value: 1e6, suffix: 'M' },
];

export function groupThousands(whole: number): string {
  // A figure that is not a finite number shows as 0 rather than "not a number" or "Infinity".
  if (!Number.isFinite(whole)) return '0';
  if (whole < 0) return `-${groupThousands(-whole)}`;
  const digits = Math.floor(whole).toString();
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    const fromEnd = digits.length - i;
    if (i > 0 && fromEnd % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return out;
}

const EXPONENT_FROM = 1e21;

export function formatDust(amount: number): string {
  if (!Number.isFinite(amount)) return '0';
  if (amount < 0) return `-${formatDust(-amount)}`;
  if (amount >= EXPONENT_FROM) {
    const [mantissa, exponent] = amount.toExponential(2).split('e+');
    return `${mantissa}e${exponent}`;
  }
  for (let i = 0; i < SUFFIXES.length; i += 1) {
    const entry = SUFFIXES[i]!;
    if (amount < entry.value) continue;
    const scaled = (amount / entry.value).toFixed(2);
    // 999.995 of a scale rounds to "1000.00"; that reads as one of the scale above.
    if (scaled === '1000.00') return i === 0 ? formatDust(entry.value * 1000) : `1.00${SUFFIXES[i - 1]!.suffix}`;
    return `${scaled}${entry.suffix}`;
  }
  return groupThousands(amount);
}

export function formatRate(perSecond: number): string {
  if (!Number.isFinite(perSecond)) return '0.0';
  if (perSecond < 0) return `-${formatRate(-perSecond)}`;
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
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
