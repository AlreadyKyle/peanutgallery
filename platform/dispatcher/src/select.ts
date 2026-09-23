// Pure card selection: which funded cards may run a session at all, and in what order. Money is
// throttle.ts's: a runnable card starts only when what it still needs fits what is available to it.

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
  horizon: string;
  folder: string;
  lane: string;
}

// The platform code lane is closed at launch. The board signs in on the site's own origin, so no
// card-built JavaScript may ship beside it until the board has an origin of its own (the backlog
// card "Board on its own site").
export function closedLane(card: Pick<SelectableCard, 'folder' | 'lane'>): boolean {
  return card.folder === 'platform' && card.lane === 'code';
}

// A card a session may be started for: funded, on horizon now, from a write-safe source, not
// vetoed, with an executor, and not in a closed lane.
export function runnable(card: SelectableCard): boolean {
  if (card.stage !== 'funded') return false;
  if (card.horizon !== 'now') return false;
  if (!SESSION_SOURCES.includes(card.source)) return false;
  if (card.director_stance === 'vetoed') return false;
  if (card.executor_role_id === null) return false;
  return !closedLane(card);
}

export function orderCards<T extends SelectableCard>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// The runnable cards, lowest priority number first, then oldest.
export function runnableInOrder<T extends SelectableCard>(cards: readonly T[]): T[] {
  return orderCards(cards.filter(runnable));
}
