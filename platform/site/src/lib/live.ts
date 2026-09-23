import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SpecRow } from '../components/Funding';
import { announcementText, changesHeight, diffSnapshots, MAX_MOTIONS_PER_POLL } from './changes';
import { faceOf, groupCards, openForFunding, plannedCards, type CardGroups } from './cards';
import { formatInteger, formatUsd, percent } from './format';
import { deal, flip, fundTick } from './motion';
import { runsCards } from './roster';
import type { Card, CardFunding, Snapshot } from './source';
import type { StudioState } from './studio';

// Home's live view (DESIGN.md, Live updates). The page is drawn from the snapshot it first loaded,
// frozen: no card is inserted, removed or reordered while the page is open, and nor is any other part
// that would move what a viewer might tap. Two changes show in place, on a card already in the Fund
// what's next grid: its bar rises (the fund tick) and it reaches its target (the flip to Funded),
// each only when its spec rows keep their height. Everything else waits behind "Show n updates",
// which redraws the page from the newest snapshot.

/** What home draws: the frozen layout's groups, with the card data shown in place. */
export type HomeView = { snapshot: Snapshot; groups: CardGroups };

/** A change a card in the fund grid can show in place. */
export type InPlace = { id: string; card: Card; funding: CardFunding | undefined; rows: SpecRow[]; motion: 'fund' | 'flip' | null };

/** The groups of `base` (the layout), each card replaced by its data in `display`. */
export function viewOf(base: Snapshot, display: Snapshot): HomeView {
  const byId = new Map(display.cards.map((card) => [card.id, card]));
  const groups = groupCards(base.cards, openForFunding(base));
  const pick = (cards: Card[]) => cards.map((card) => byId.get(card.id) ?? card);
  return {
    snapshot: display,
    groups: { now: pick(groups.now), fund: pick(groups.fund), queued: pick(groups.queued), shipped: pick(groups.shipped) },
  };
}

function contributorsOf(snapshot: Snapshot, id: string): number | undefined {
  return snapshot.funding[id]?.contributors;
}

/** The fields of a card home draws. Two cards that agree on these draw the same. */
function sameCard(a: Card, b: Card): boolean {
  return (
    a.title === b.title &&
    a.summary === b.summary &&
    a.intent === b.intent &&
    a.stage === b.stage &&
    a.folder === b.folder &&
    a.horizon === b.horizon &&
    a.funded_usd === b.funded_usd &&
    a.funding_target_usd === b.funding_target_usd &&
    a.spent_usd === b.spent_usd &&
    a.live_at === b.live_at &&
    a.executor_role_id === b.executor_role_id
  );
}

/**
 * The changes on cards in the fund grid that may show in place: the same words, the same target, and
 * either the same face or the Funded face (the flip). Its bar and spec rows change; a rise ticks.
 */
export function inPlaceChanges(base: Snapshot, display: Snapshot, latest: Snapshot): InPlace[] {
  const shownById = new Map(display.cards.map((card) => [card.id, card]));
  const nextById = new Map(latest.cards.map((card) => [card.id, card]));
  const out: InPlace[] = [];
  for (const { id } of groupCards(base.cards, openForFunding(base)).fund) {
    const shown = shownById.get(id);
    const next = nextById.get(id);
    if (shown === undefined || next === undefined) continue;
    const contributorsChanged = contributorsOf(display, id) !== contributorsOf(latest, id);
    if (sameCard(shown, next) && !contributorsChanged) continue;
    const words = shown.title === next.title && shown.summary === next.summary && shown.intent === next.intent && shown.folder === next.folder;
    const from = faceOf(shown);
    const to = faceOf(next);
    const faceOk = to === from || to === 'funded';
    if (!words || !faceOk || next.horizon !== 'now' || next.funding_target_usd !== shown.funding_target_usd) continue;
    const rows: SpecRow[] = [];
    if (next.funded_usd !== shown.funded_usd) rows.push('funded');
    if (contributorsChanged) rows.push('contributors');
    const motion = to !== from ? 'flip' : next.funded_usd > shown.funded_usd ? 'fund' : null;
    out.push({ id, card: next, funding: latest.funding[id], rows, motion });
  }
  return out;
}

/** `display` with these changes applied: the card's data and its funding row. */
export function applyChanges(display: Snapshot, changes: readonly InPlace[]): Snapshot {
  if (changes.length === 0) return display;
  const byId = new Map(changes.map((change) => [change.id, change]));
  const funding = { ...display.funding };
  for (const change of changes) {
    if (change.funding === undefined) delete funding[change.id];
    else funding[change.id] = change.funding;
  }
  return { ...display, cards: display.cards.map((card) => byId.get(card.id)?.card ?? card), funding };
}

function firstRunning(snapshot: Snapshot): string {
  const laneOpen = snapshot.platformLaneOpen === true;
  return snapshot.roles
    .filter((role) => role.state === 'active' && runsCards(role, laneOpen))
    .slice(0, 3)
    .map((role) => `${role.id}:${role.name}:${role.description ?? ''}`)
    .join('|');
}

function plannedTitles(snapshot: Snapshot): string {
  const planned = plannedCards(snapshot.cards);
  return [...planned.next, ...planned.later]
    .slice(0, 3)
    .map((card) => `${card.id}:${card.title}`)
    .join('|');
}

/**
 * How many updates wait behind "Show n updates": each card that would arrive, leave, move or change
 * and is not shown in place yet, plus each other part of home that changed (the status line and the
 * pause, the pool, the agent actions, the team strip, what is planned next).
 */
export function pendingCount(base: Snapshot, display: Snapshot, latest: Snapshot): number {
  const ids = new Set(diffSnapshots(base, latest, { hidden: false }).held.map((item) => item.id));
  const nextById = new Map(latest.cards.map((card) => [card.id, card]));
  for (const card of display.cards) {
    const next = nextById.get(card.id);
    if (next === undefined) continue;
    if (!sameCard(card, next) || contributorsOf(display, card.id) !== contributorsOf(latest, card.id)) ids.add(card.id);
  }
  const others = [
    base.paused !== latest.paused || base.missing.includes('studio') !== latest.missing.includes('studio'),
    (base.pool?.balance_usd ?? null) !== (latest.pool?.balance_usd ?? null),
    base.events.slice(0, 5).map((event) => event.id).join() !== latest.events.slice(0, 5).map((event) => event.id).join(),
    firstRunning(base) !== firstRunning(latest),
    plannedTitles(base) !== plannedTitles(latest),
  ].filter(Boolean).length;
  return ids.size + others;
}

/** A spec row's value as SpecRows draws it. */
function rowText(change: InPlace, row: SpecRow): string {
  if (row === 'funded') return `${formatUsd(change.card.funded_usd)} of ${formatUsd(change.card.funding_target_usd)}`;
  return formatInteger(change.funding?.contributors ?? 0);
}

function cardElement(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.fund-grid li.card[data-card="${CSS.escape(id)}"]`);
}

/**
 * The height rule: a change shows in place only when none of its spec rows would change height. A
 * row that is not drawn yet (the contributors row appearing) always would, so it waits.
 */
function keepsHeight(change: InPlace): boolean {
  const card = cardElement(change.id);
  if (card === null) return true;
  return change.rows.every((row) => {
    const value = card.querySelector<HTMLElement>(`[data-row="${row}"] dd`);
    return value !== null && !changesHeight(value, rowText(change, row));
  });
}

/**
 * Home's live view of the studio: the frozen view, the waiting count, the Pause toggle, Show updates,
 * the spec rows that changed since the last poll and the announcer's words.
 */
export function useLiveHome(studio: StudioState) {
  const latest = studio.state === 'ready' ? studio.snapshot : null;
  const [view, setView] = useState<{ base: Snapshot; display: Snapshot } | null>(null);
  const [paused, setPaused] = useState(false);
  const [changed, setChanged] = useState<Record<string, SpecRow[]>>({});
  const [message, setMessage] = useState('');
  const viewRef = useRef(view);
  viewRef.current = view;
  const previous = useRef<Snapshot | null>(null);
  const announced = useRef(new Set<string>());
  const ticks = useRef<{ id: string; from: number; to: number }[]>([]);
  const dealIds = useRef<string[]>([]);

  useEffect(() => {
    if (latest === null) return;
    const before = previous.current;
    previous.current = latest;
    if (before !== null && before !== latest) {
      for (const item of diffSnapshots(before, latest, { hidden: false }).announce) {
        const key = `${item.kind}:${item.id}`;
        if (announced.current.has(key)) continue;
        announced.current.add(key);
        setMessage(announcementText(item));
      }
    }
    const current = viewRef.current;
    if (current === null) {
      setView({ base: latest, display: latest });
      return;
    }
    if (paused) return;
    const accepted = inPlaceChanges(current.base, current.display, latest).filter(keepsHeight);
    setChanged(Object.fromEntries(accepted.filter((change) => change.rows.length > 0).map((change) => [change.id, change.rows])));
    if (accepted.length === 0) return;
    const hidden = document.visibilityState === 'hidden';
    const moving = hidden ? [] : accepted.filter((change) => change.motion !== null).slice(0, MAX_MOTIONS_PER_POLL);
    const flips = moving.filter((change) => change.motion === 'flip');
    const now = accepted.filter((change) => !flips.includes(change));
    ticks.current = moving
      .filter((change) => change.motion === 'fund')
      .map((change) => {
        const shown = current.display.cards.find((card) => card.id === change.id);
        return {
          id: change.id,
          from: percent(shown?.funded_usd ?? 0, change.card.funding_target_usd),
          to: percent(change.card.funded_usd, change.card.funding_target_usd),
        };
      });
    setView({ base: current.base, display: applyChanges(current.display, now) });
    for (const change of flips) {
      void flip(cardElement(change.id), () =>
        setView((was) => (was === null ? was : { base: was.base, display: applyChanges(was.display, [change]) })),
      );
    }
    // `latest` changes identity on each load; the pause flag re-runs the in-place pass on resume.
  }, [latest, paused]);

  useLayoutEffect(() => {
    for (const tick of ticks.current) fundTick(cardElement(tick.id)?.querySelector<HTMLElement>('.funding-bar-fill') ?? null, tick.from, tick.to);
    ticks.current = [];
    if (dealIds.current.length > 0) {
      deal(dealIds.current.map(cardElement).filter((el): el is HTMLElement => el !== null));
      dealIds.current = [];
    }
  }, [view]);

  const show = useCallback(() => {
    const current = viewRef.current;
    if (current === null || latest === null) return;
    dealIds.current = diffSnapshots(current.base, latest, { hidden: false })
      .held.filter((item) => item.kind === 'enter')
      .map((item) => item.id);
    setChanged({});
    setView({ base: latest, display: latest });
  }, [latest]);

  const count = view === null || latest === null ? 0 : pendingCount(view.base, view.display, latest);
  return {
    view: view === null ? null : viewOf(view.base, view.display),
    count,
    paused,
    togglePause: () => setPaused((was) => !was),
    show,
    changed,
    message,
  };
}
