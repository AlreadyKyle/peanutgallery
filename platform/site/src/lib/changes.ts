import { copy } from './copy';
import { faceOf, groupCards, openForFunding, type CardGroups, type Face } from './cards';
import type { Card, Snapshot } from './source';

// Live changes between two snapshots (DESIGN.md, Motion and Live updates). Motion comes only from a
// real change seen between polls: never on first load, never in a hidden tab, at most three per poll.
// Anything that would insert, remove or reorder a card, or change a box's height, is held behind
// "Show n updates" so nothing a viewer might tap moves while they look.

export const MAX_MOTIONS_PER_POLL = 3;
/** The count of waiting updates is announced when it goes from none to some, at most once a minute. */
export const COUNT_ANNOUNCE_GAP_MS = 60_000;
/** The updates button reads "Show 99+ updates" above this. */
export const UPDATES_CAP = 99;

/** A change a card on screen can show in place: its bar ticks, or it turns to a new face. */
export type Motion = { kind: 'fund'; id: string; from: number; to: number } | { kind: 'flip'; id: string; from: Face; to: Face };

/** A change that would move other cards: held until the viewer presses Show updates. */
export type Held = { kind: 'enter' | 'leave' | 'move'; id: string };

/** Funded and shipped are said once through the polite announcer. */
export type Announcement = { kind: 'funded' | 'shipped'; id: string; title: string };

export type Diff = {
  /** Play these, in order: at most three per poll. */
  motions: Motion[];
  /** Apply these at once, without motion: the ones past three, or every one in a hidden tab. */
  still: Motion[];
  held: Held[];
  announce: Announcement[];
};

const EMPTY: Diff = { motions: [], still: [], held: [], announce: [] };
const GROUPS: readonly (keyof CardGroups)[] = ['now', 'fund', 'queued', 'shipped'];

/** Where each card sits: its group and its index there. */
function places(snapshot: Snapshot): Map<string, { group: keyof CardGroups; index: number; card: Card }> {
  const groups = groupCards(snapshot.cards, openForFunding(snapshot));
  const out = new Map<string, { group: keyof CardGroups; index: number; card: Card }>();
  for (const group of GROUPS) groups[group].forEach((card, index) => out.set(card.id, { group, index, card }));
  return out;
}

/** What changed from `prev` to `next`. With no previous snapshot (the first load) nothing did. */
export function diffSnapshots(prev: Snapshot | null, next: Snapshot, { hidden }: { hidden: boolean }): Diff {
  if (prev === null) return EMPTY;
  const before = places(prev);
  const after = places(next);
  const found: Motion[] = [];
  const held: Held[] = [];
  const announce: Announcement[] = [];

  for (const [id, now] of after) {
    const was = before.get(id);
    if (was === undefined) {
      held.push({ kind: 'enter', id });
      continue;
    }
    const from = faceOf(was.card);
    const to = faceOf(now.card);
    if (now.card.funded_usd > was.card.funded_usd) {
      found.push({ kind: 'fund', id, from: was.card.funded_usd, to: now.card.funded_usd });
    }
    if (from !== to) {
      found.push({ kind: 'flip', id, from, to });
      if (to === 'funded') announce.push({ kind: 'funded', id, title: now.card.title });
      if (to === 'live') announce.push({ kind: 'shipped', id, title: now.card.title });
    }
    if (was.group !== now.group || was.index !== now.index) held.push({ kind: 'move', id });
  }
  for (const id of before.keys()) if (!after.has(id)) held.push({ kind: 'leave', id });

  if (hidden) return { motions: [], still: found, held, announce };
  return { motions: found.slice(0, MAX_MOTIONS_PER_POLL), still: found.slice(MAX_MOTIONS_PER_POLL), held, announce };
}

/** The updates button's label: "Up to date", "Show 1 update", "Show n updates", capped at 99+. */
export function updatesLabel(count: number): string {
  if (count <= 0) return copy.upToDate;
  if (count === 1) return copy.showOneUpdate;
  return copy.showUpdates.replace('{n}', count > UPDATES_CAP ? `${UPDATES_CAP}+` : String(count));
}

/** The longest label the button can show, which holds its width from first paint. */
export const LONGEST_UPDATES_LABEL = copy.showUpdates.replace('{n}', `${UPDATES_CAP}+`);

/** Announce the waiting count only when it goes from none to some, and at most once a minute. */
export function shouldAnnounceCount(previous: number, next: number, lastAnnouncedAt: number | null, now: number): boolean {
  if (previous > 0 || next <= 0) return false;
  return lastAnnouncedAt === null || now - lastAnnouncedAt >= COUNT_ANNOUNCE_GAP_MS;
}

/** The announcer's words for a funded or shipped card. */
export function announcementText(item: Announcement): string {
  return (item.kind === 'funded' ? copy.announceFunded : copy.announceShipped).replace('{title}', item.title);
}

/**
 * The height rule: would putting `text` in this element change its box's height? The text node is
 * swapped, measured and put back in the same task, so no shift is ever painted, and the node React
 * owns is kept. A change that would change the height is held behind Show updates.
 */
export function changesHeight(element: HTMLElement, text: string): boolean {
  const node = [...element.childNodes].find((child): child is Text => child.nodeType === Node.TEXT_NODE);
  if (node === undefined) return true;
  const before = element.getBoundingClientRect().height;
  const old = node.data;
  node.data = text;
  const after = element.getBoundingClientRect().height;
  node.data = old;
  return after !== before;
}
