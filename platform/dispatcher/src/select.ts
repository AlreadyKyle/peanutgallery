// Pure card selection: the funded, non-vetoed card from a write-safe source with an executor
// whose estimate fits, lowest priority number first, then oldest.

// Kernel: no agent with write access reads free text from the public. A community card's
// title, intent and acceptance test are public text until a non-writing role rewrites them
// into a card of its own, so only these sources reach a session in this build.
export const SESSION_SOURCES: readonly string[] = ['board', 'agent', 'decision'];

export interface SelectableCard {
  id: string;
  stage: string;
  source: string;
  priority: number;
  created_at: string;
  estimate_usd: number;
  severity: string | null;
  director_stance: string;
  executor_role_id: string | null;
}

// S1 cards may draw on the incident reserve in addition to the available pool.
export function budgetFor(card: SelectableCard, availableUsd: number, incidentReserveUsd: number): number {
  return card.severity === 's1' ? availableUsd + incidentReserveUsd : availableUsd;
}

export function eligible(card: SelectableCard, availableUsd: number, incidentReserveUsd: number): boolean {
  if (card.stage !== 'funded') return false;
  if (!SESSION_SOURCES.includes(card.source)) return false;
  if (card.director_stance === 'vetoed') return false;
  if (card.executor_role_id === null) return false;
  return card.estimate_usd <= budgetFor(card, availableUsd, incidentReserveUsd);
}

export function orderCards<T extends SelectableCard>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function selectCard<T extends SelectableCard>(
  cards: readonly T[],
  availableUsd: number,
  incidentReserveUsd: number,
): T | null {
  const ordered = orderCards(cards);
  return ordered.find((card) => eligible(card, availableUsd, incidentReserveUsd)) ?? null;
}
