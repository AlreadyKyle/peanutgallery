import { copy } from './copy';
import { formatUsd, toNumber, type Numeric } from './format';
import { legal } from './legal';

// Kernel (docs/specs/supporter-pages.md): the public line for each agent event, by its fixed key
// (public.event_line_key), used by home's feed and a card's own page. Kernel because the allowlist
// of what an agent's steps may say in public is a privacy rule.

type LineWords = { one: string; many?: string };

/** The words for every key: copy.ts's, and legal.ts's for the steps that name money or funding. */
const WORDS: Record<string, LineWords> = { ...copy.eventLines, ...legal.eventLinesMoney };

/** A line's words for its key, one event or a run of n; an unknown key reads as other. A top-up
 * names its amount: the event's usd (public_agent_events.usd). */
export function eventLine(key: string, count = 1, usd: Numeric | undefined = null): string {
  const words = WORDS[key] ?? WORDS.other!;
  const line =
    count <= 1
      ? words.one
      : words.many === undefined
        ? `${words.one} ${copy.eventTimes.replace('{n}', String(count))}`
        : words.many.replace('{n}', String(count));
  return line.replace('{usd}', formatUsd(toNumber(usd) ?? 0));
}

/**
 * Consecutive lines by the same agent with the same key on the same card, as one line with a count
 * ("Builder A read 12 files"). The lines keep their order; each run keeps its first line's fields.
 * Home's feed and a card's own page both use it.
 */
export function collapseLines<T extends { role_id: string | null; line_key?: string; card_id?: string | null }>(lines: readonly T[]): (T & { count: number })[] {
  const out: (T & { count: number })[] = [];
  for (const line of lines) {
    const last = out.at(-1);
    if (
      last !== undefined &&
      last.role_id === line.role_id &&
      (last.line_key ?? '') === (line.line_key ?? '') &&
      line.line_key !== undefined &&
      (last.card_id ?? null) === (line.card_id ?? null)
    ) {
      last.count += 1;
    } else {
      out.push({ ...line, count: 1 });
    }
  }
  return out;
}
