export interface Strings {
  title: string;
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
}

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
  return {
    title: requireText(raw, 'title', 'strings'),
    labels,
    strikeDescription: requireText(raw, 'strikeDescription', 'strings'),
    unitDescriptions: requireTextRecord(raw, 'unitDescriptions', 'strings'),
    effects: {
      unit: requireText(effectsRaw, 'unit', 'strings.effects'),
      multiplier: requireText(effectsRaw, 'multiplier', 'strings.effects'),
    },
  };
}
