import type { UnlockRow } from '../sim/types';

export const SCREEN_WIDTH = 420;
export const SCREEN_HEIGHT = 880;
// The canvas draws at this many pixels per layout pixel, so FIT's upscaling and high-density screens
// stay sharp; the camera zooms by the same factor, so layout and input coordinates are unchanged.
export const RENDER_SCALE = Math.min(4, Math.ceil((globalThis.devicePixelRatio || 1) * 1.5));

export const UNLOCK_ROW_HEIGHT = 22;
export const MAX_UNEARNED_UNLOCK_LINES = 3;

export type UnlockListLine =
  | { kind: 'earned'; count: number; y: number }
  | { kind: 'unlock'; row: UnlockRow; y: number };

export function earnedUnlockCount(rows: readonly UnlockRow[], earnedIds: ReadonlySet<string>): number {
  return rows.reduce((count, row) => count + (earnedIds.has(row.id) ? 1 : 0), 0);
}

export function layoutUnlockList(
  topY: number,
  rows: readonly UnlockRow[],
  earnedIds: ReadonlySet<string>,
): UnlockListLine[] {
  const lines: UnlockListLine[] = [];
  let y = topY;

  const earnedCount = earnedUnlockCount(rows, earnedIds);
  if (earnedCount > 0) {
    lines.push({ kind: 'earned', count: earnedCount, y });
    y += UNLOCK_ROW_HEIGHT;
  }

  let shown = 0;
  for (const row of rows) {
    if (shown >= MAX_UNEARNED_UNLOCK_LINES) break;
    if (earnedIds.has(row.id)) continue;
    lines.push({ kind: 'unlock', row, y });
    y += UNLOCK_ROW_HEIGHT;
    shown += 1;
  }

  return lines;
}
