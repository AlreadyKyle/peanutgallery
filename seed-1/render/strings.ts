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
    welcomeBack: string;
    unlockBanner: string;
    nextGoal: string;
    toGo: string;
    unlockedTitle: string;
    welcomeTitle: string;
    streak: string;
    newUnit: string;
    tapHint: string;
    awayFor: string;
    dustGain: string;
  };
  strikeDescription: string;
  unitDescriptions: Record<string, string>;
  effects: {
    unit: string;
    multiplier: string;
    strike: string;
    weather: string;
    gems: string;
    fork: string;
  };
  // The Share your run button under the canvas (render/share.ts).
  share: {
    button: string;
    text: string;
    copied: string;
    failed: string;
    imageDust: string;
    imageUnlocks: string;
  };
  // Save as seed, beside Share your run, and the offer a seed link opens with (render/seed-ui.ts).
  seed: {
    button: string;
    text: string;
    copied: string;
    failed: string;
    offerTitle: string;
    offerBody: string;
    offerReplace: string;
    start: string;
    keep: string;
    invalid: string;
    gallery: string;
    galleryLabel: string;
  };
  // The layers after the units: first steps, milestones, weather, gems and perks, forks, orders and
  // dust devils (render/depth.ts).
  depth: Record<(typeof DEPTH_KEYS)[number], string>;
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
  'welcomeBack',
  'unlockBanner',
  'nextGoal',
  'toGo',
  'unlockedTitle',
  'welcomeTitle',
  'streak',
  'newUnit',
  'tapHint',
  'awayFor',
  'dustGain',
] as const;

const SHARE_KEYS = ['button', 'text', 'copied', 'failed', 'imageDust', 'imageUnlocks'] as const;

const SEED_KEYS = ['button', 'text', 'copied', 'failed', 'offerTitle', 'offerBody', 'offerReplace', 'start', 'keep', 'invalid', 'gallery', 'galleryLabel'] as const;

const DEPTH_KEYS = [
  'hintStrike',
  'hintBuy',
  'notEnough',
  'milestoneKicker',
  'milestoneTitle',
  'milestoneBody',
  'milestoneNext',
  'milestoneSaid',
  'weatherKicker',
  'weatherLeft',
  'weatherSaid',
  'weatherCleared',
  'weatherAll',
  'weatherStrike',
  'weatherUnit',
  'gemsHeading',
  'gemsHeld',
  'seasonLabel',
  'press',
  'pressLabel',
  'pressNotYet',
  'pressConfirm',
  'pressYes',
  'pressNo',
  'pressedKicker',
  'pressedTitle',
  'pressedBody',
  'pressedSaid',
  'perksHeading',
  'perkCost',
  'perkOwned',
  'perkLabel',
  'perkOwnedLabel',
  'perkBought',
  'perkProduction',
  'perkStrike',
  'perkStart',
  'perkWeather',
  'perkThrift',
  'nextGem',
  'gemsIntro',
  'perksShow',
  'forkKicker',
  'forkNote',
  'forkMore',
  'forkLabel',
  'forkChosenSaid',
  'forkOpenSaid',
  'forkOr',
  'forkMultiplier',
  'forkStrike',
  'forkUnit',
  'forkWeather',
  'forkDevil',
  'forkOrder',
  'orderKicker',
  'orderOwn',
  'orderGather',
  'orderStrikes',
  'orderProgress',
  'orderFill',
  'orderFillLabel',
  'orderRest',
  'orderSwap',
  'orderSwapLabel',
  'orderSaid',
  'orderFilledSaid',
  'orderFilledToast',
  'ordersCount',
  'devilKicker',
  'devilCatch',
  'devilCatchLabel',
  'devilSaid',
  'devilGone',
  'devilCaughtTitle',
  'devilCaughtBody',
  'devilCaughtSaid',
  'whirl',
  'whirlEffect',
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
  const shareRaw = raw['share'];
  if (!isRecord(shareRaw)) throw new Error('strings: "share" must be an object');
  const share = {} as Strings['share'];
  for (const key of SHARE_KEYS) share[key] = requireText(shareRaw, key, 'strings.share');
  const seedRaw = raw['seed'];
  if (!isRecord(seedRaw)) throw new Error('strings: "seed" must be an object');
  const seed = {} as Strings['seed'];
  for (const key of SEED_KEYS) seed[key] = requireText(seedRaw, key, 'strings.seed');
  const depthRaw = raw['depth'];
  if (!isRecord(depthRaw)) throw new Error('strings: "depth" must be an object');
  const depth = {} as Strings['depth'];
  for (const key of DEPTH_KEYS) depth[key] = requireText(depthRaw, key, 'strings.depth');
  return {
    title: requireText(raw, 'title', 'strings'),
    tabTitle: requireText(raw, 'tabTitle', 'strings'),
    labels,
    strikeDescription: requireText(raw, 'strikeDescription', 'strings'),
    unitDescriptions: requireTextRecord(raw, 'unitDescriptions', 'strings'),
    effects: {
      unit: requireText(effectsRaw, 'unit', 'strings.effects'),
      multiplier: requireText(effectsRaw, 'multiplier', 'strings.effects'),
      strike: requireText(effectsRaw, 'strike', 'strings.effects'),
      weather: requireText(effectsRaw, 'weather', 'strings.effects'),
      gems: requireText(effectsRaw, 'gems', 'strings.effects'),
      fork: requireText(effectsRaw, 'fork', 'strings.effects'),
    },
    share,
    seed,
    depth,
    a11y,
  };
}
