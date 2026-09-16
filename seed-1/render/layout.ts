import type { UnlockRow } from '../sim/types';

export const SCREEN_WIDTH = 420;
export const SCREEN_HEIGHT = 880;

export const UNLOCK_ROW_HEIGHT = 22;
export const MAX_UNEARNED_UNLOCK_LINES = 3;

export type UnlockListLine =
  | { kind: 'earned'; count: number; y: number }
  | { kind: 'unlock'; row: UnlockRow; y: number };

export function layoutUnlockList(
  topY: number,
  rows: readonly UnlockRow[],
  earnedIds: ReadonlySet<string>,
): UnlockListLine[] {
  const lines: UnlockListLine[] = [];
  let y = topY;

  const earnedCount = rows.reduce((count, row) => count + (earnedIds.has(row.id) ? 1 : 0), 0);
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
