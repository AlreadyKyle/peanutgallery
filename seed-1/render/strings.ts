export interface Strings {
  title: string;
  tabTitle: string;
  labels: {
    dust: string;
    perSecond: string;
    strike: string;
    buy: string;
    owned: string;
    units: string;
    unlocks: string;
    unlockedCount: string;
    nextUnlock: string;
    allUnlocked: string;
    unlocksEarned: string;
  };
  strikeDescription: string;
  unitDescriptions: Record<string, string>;
  effects: {
    unit: string;
    multiplier: string;
  };
  // The accessible DOM layer's text (render/controls.ts): the canvas is hidden from assistive technology.
  a11y: {
    controls: string;
    dustStatus: string;
    buyUnit: string;
    bought: string;
    unlocked: string;
  };
}

const A11Y_KEYS = ['controls', 'dustStatus', 'buyUnit', 'bought', 'unlocked'] as const;

const LABEL_KEYS = [
  'dust',
  'perSecond',
  'strike',
  'buy',
  'owned',
  'units',
  'unlocks',
  'unlockedCount',
  'nextUnlock',
  'allUnlocked',
  'unlocksEarned',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireText(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${where}: "${key}" must be a non-empty string`);
  return value;
}

function requireTextRecord(record: Record<string, unknown>, key: string, where: string): Record<string, string> {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`${where}: "${key}" must be an object`);
  const out: Record<string, string> = {};
  for (const [name, text] of Object.entries(value)) {
    if (typeof text !== 'string' || text.length === 0) throw new Error(`${where}: "${key}.${name}" must be a non-empty string`);
    out[name] = text;
  }
  return out;
}

export function parseStrings(raw: unknown): Strings {
  if (!isRecord(raw)) throw new Error('strings: must be an object');
  const labelsRaw = raw['labels'];
  if (!isRecord(labelsRaw)) throw new Error('strings: "labels" must be an object');
  const labels = {} as Strings['labels'];
  for (const key of LABEL_KEYS) labels[key] = requireText(labelsRaw, key, 'strings.labels');
  const effectsRaw = raw['effects'];
  if (!isRecord(effectsRaw)) throw new Error('strings: "effects" must be an object');
  const a11yRaw = raw['a11y'];
  if (!isRecord(a11yRaw)) throw new Error('strings: "a11y" must be an object');
  const a11y = {} as Strings['a11y'];
  for (const key of A11Y_KEYS) a11y[key] = requireText(a11yRaw, key, 'strings.a11y');
  return {
    title: requireText(raw, 'title', 'strings'),
    tabTitle: requireText(raw, 'tabTitle', 'strings'),
    labels,
    strikeDescription: requireText(raw, 'strikeDescription', 'strings'),
    unitDescriptions: requireTextRecord(raw, 'unitDescriptions', 'strings'),
    effects: {
      unit: requireText(effectsRaw, 'unit', 'strings.effects'),
      multiplier: requireText(effectsRaw, 'multiplier', 'strings.effects'),
    },
    a11y,
  };
}
