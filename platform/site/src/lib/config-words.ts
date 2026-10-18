import type { ConfigCheck } from './card-source';
import { copy } from './copy';

// "What changed" in plain words (docs/specs/supporter-loop.md). A check's raw path, such as
// `rows[id=mill].baseCost`, reads as "Mill: costs 1500 dust" where the game's config says what the
// field means (seed-1/config/spawn-table.json, seed-1/config/unlocks.json, seed-1/sim). Anything this
// table does not know is counted, not shown: a raw file path and value means nothing to a reader. The
// check carries only the value after the change, so no line claims what it was before.

const words = copy.cardPage.plain;

/** `<collection>[id=<id>].<field>`, the shape the game's config checks take. */
const ROW_PATH = /^([A-Za-z]+)\[id=([a-z0-9-]+)\]\.([A-Za-z.]+)$/;

/** Which kind of row a collection holds, by the collection's name in the game's config. */
const COLLECTIONS: Record<string, 'building' | 'unlock'> = { rows: 'building', buildings: 'building', unlocks: 'unlock' };

/** Each known field of a row, and the words it reads as. */
const FIELDS: Record<'building' | 'unlock', Record<string, string>> = {
  building: { baseCost: words.baseCost, rate: words.rate, name: words.name },
  unlock: { atTotalDust: words.atTotalDust, name: words.name, 'effect.value': words.effectValue },
};

/** Fills {key} slots with the text as written: a function replacer, so `$&` or `$$` in a value stays literal. */
function fill(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) out = out.replace(`{${key}}`, () => value);
  return out;
}

/** "sharper-tools" reads as "Sharper tools". */
export function idName(id: string): string {
  const spaced = id.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The check in plain words, or null when this table cannot say what it means. */
export function plainCheck(check: ConfigCheck): string | null {
  const match = ROW_PATH.exec(check.path);
  if (match === null || check.value === null) return null;
  const [, collection, id, field] = match as unknown as [string, string, string, string];
  // Own keys only: a path such as `constructor[id=x].toString` must fall back, not reach the prototype.
  if (!Object.hasOwn(COLLECTIONS, collection)) return null;
  const kind = COLLECTIONS[collection]!;
  if (!Object.hasOwn(FIELDS[kind], field)) return null;
  const template = FIELDS[kind][field]!;
  return fill(template, { name: idName(id), value: check.value });
}

/**
 * What "What changed" shows: the checks it can say in plain words, then one line counting the rest
 * ("And 1 more value in the game's settings."), or only that count when none is plain. Null when there
 * is nothing left over.
 */
export function changedLines(checks: readonly ConfigCheck[]): { lines: string[]; rest: string | null } {
  const lines = checks.map(plainCheck).filter((line): line is string => line !== null);
  const left = checks.length - lines.length;
  if (left === 0) return { lines, rest: null };
  const n = String(left);
  if (lines.length === 0) return { lines, rest: left === 1 ? words.onlyOne : fill(words.onlyMany, { n }) };
  return { lines, rest: left === 1 ? words.moreOne : fill(words.moreMany, { n }) };
}
