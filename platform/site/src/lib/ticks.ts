// The labels under /goals' track (pages/Goals.tsx). Each label sits under its tick, pulled toward the
// track's middle in proportion to where the tick is (CSS: left at the tick, then back by the same
// share of its own width), so a label at either end stays inside the track. Ticks can still sit
// close together ($50 and $100 on a track that runs to thousands), so the labels that would touch
// another are hidden, the most useful kept first.

/** A label's measured box along the track, in pixels. */
export type LabelBox = { readonly left: number; readonly right: number };

/**
 * Which labels to show: each in `order` (most useful first) is kept unless it comes within `gap`
 * pixels of one already kept. A box with no width has not been measured yet (or cannot be, as in a
 * test without layout) and is always shown.
 */
export function visibleLabels(boxes: readonly LabelBox[], order: readonly number[], gap = 8): boolean[] {
  const shown = boxes.map((box) => box.right - box.left <= 0);
  const kept: LabelBox[] = [];
  for (const index of order) {
    const box = boxes[index];
    if (box === undefined || box.right - box.left <= 0) continue;
    if (kept.every((other) => box.left >= other.right + gap || box.right + gap <= other.left)) {
      kept.push(box);
      shown[index] = true;
    }
  }
  return shown;
}

/** The order labels are kept in: the next goal first, then the last (the track's end), then left to right. */
export function labelOrder(states: readonly string[]): number[] {
  const all = states.map((_, i) => i);
  const next = states.indexOf('next');
  const first = [next, states.length - 1].filter((i, at, list) => i >= 0 && list.indexOf(i) === at);
  return [...first, ...all.filter((i) => !first.includes(i))];
}
