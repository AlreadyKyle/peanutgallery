import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SpecRow } from '../components/Funding';
import { announcementText, diffSnapshots, MAX_MOTIONS_PER_POLL } from './changes';
import { faceOf, groupCards, fundingPlace, type CardGroups } from './cards';
import { percent } from './format';
import { deal, flip, fundTick } from './motion';
import type { Card, CardFunding, Snapshot } from './source';
import type { StudioState } from './studio';

// Home's live view (DESIGN.md, Live updates). Each new snapshot is drawn as it arrives; there is no
// button to press and nothing to pause. A card already in the Fund what's next grid shows its change
// with motion: its bar rises (the fund tick) or it turns to Funded (the flip). A card that arrives is
// dealt in. Everything else simply redraws.

/** What home draws: the frozen layout's groups, with the card data shown in place. */
export type HomeView = { snapshot: Snapshot; groups: CardGroups };

/** A change a card in the fund grid can show in place. */
export type InPlace = { id: string; card: Card; funding: CardFunding | undefined; rows: SpecRow[]; motion: 'fund' | 'flip' | null };

/** The groups of `base` (the layout), each card replaced by its data in `display`. */
export function viewOf(base: Snapshot, display: Snapshot): HomeView {
  const byId = new Map(display.cards.map((card) => [card.id, card]));
  const groups = groupCards(base.cards, fundingPlace(base));
  const pick = (cards: Card[]) => cards.map((card) => byId.get(card.id) ?? card);
  return {
    snapshot: display,
    groups: { now: pick(groups.now), fund: pick(groups.fund), queued: pick(groups.queued), shipped: pick(groups.shipped), next: pick(groups.next) },
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
  for (const { id } of groupCards(base.cards, fundingPlace(base)).fund) {
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

function cardElement(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.fund-grid li.card[data-card="${CSS.escape(id)}"]`);
}

/** `latest`, with the flipping cards still drawn as `shown` until their flip turns them. */
function holdFlips(latest: Snapshot, shown: Snapshot, flips: readonly InPlace[]): Snapshot {
  if (flips.length === 0) return latest;
  const ids = new Set(flips.map((change) => change.id));
  const shownById = new Map(shown.cards.map((card) => [card.id, card]));
  const funding = { ...latest.funding };
  for (const id of ids) {
    const was = shown.funding[id];
    if (was === undefined) delete funding[id];
    else funding[id] = was;
  }
  return { ...latest, cards: latest.cards.map((card) => (ids.has(card.id) ? shownById.get(card.id) ?? card : card)), funding };
}

/**
 * Home's live view of the studio: the newest snapshot, the spec rows that changed since the last
 * poll and the announcer's words.
 */
export function useLiveHome(studio: StudioState) {
  const latest = studio.state === 'ready' ? studio.snapshot : null;
  const [view, setView] = useState<{ base: Snapshot; display: Snapshot } | null>(null);
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
    if (current.base === latest) return;
    const inPlace = inPlaceChanges(current.base, current.display, latest);
    setChanged(Object.fromEntries(inPlace.filter((change) => change.rows.length > 0).map((change) => [change.id, change.rows])));
    const hidden = document.visibilityState === 'hidden';
    const moving = hidden ? [] : inPlace.filter((change) => change.motion !== null).slice(0, MAX_MOTIONS_PER_POLL);
    const flips = moving.filter((change) => change.motion === 'flip');
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
    dealIds.current = hidden
      ? []
      : diffSnapshots(current.base, latest, { hidden: false })
          .held.filter((item) => item.kind === 'enter')
          .map((item) => item.id);
    setView({ base: latest, display: holdFlips(latest, current.display, flips) });
    for (const change of flips) {
      void flip(cardElement(change.id), () =>
        setView((was) => (was === null ? was : { base: was.base, display: applyChanges(was.display, [change]) })),
      );
    }
    // `latest` changes identity on each load.
  }, [latest]);

  useLayoutEffect(() => {
    for (const tick of ticks.current) fundTick(cardElement(tick.id)?.querySelector<HTMLElement>('.funding-bar-fill') ?? null, tick.from, tick.to);
    ticks.current = [];
    if (dealIds.current.length > 0) {
      deal(dealIds.current.map(cardElement).filter((el): el is HTMLElement => el !== null));
      dealIds.current = [];
    }
  }, [view]);

  return {
    view: view === null ? null : viewOf(view.base, view.display),
    changed,
    message,
  };
}
