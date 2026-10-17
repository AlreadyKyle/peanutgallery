import './style.css';
import { awaySeconds, parseSavedAt, parseSavedState } from '../sim/save';
import { createSim, step } from '../sim/sim';
import type { SimState } from '../sim/types';
import { AccessibleControls } from './controls';
import { countEvent } from './count';
import { Game, SAVE_INTERVAL_MS, SAVE_KEY } from './game';
import { Hud } from './hud';
import { loadGameData, type GameData } from './load';
import { loadNextCard, showNextCard } from './next-card';
import { DustScene, type SafeArea } from './scene';
import { decodeSeed, seedFromSearch } from './seed-code';
import { attachSeedButton, offerSeed } from './seed-ui';
import { attachShare } from './share';
import { runWhatsNew } from './whats-new';

const LOAD_FAILED = 'The game data did not load. Reload the page to try again.';
// The welcome-back moment shows only for an absence long enough to feel like one.
const MIN_WELCOME_SECONDS = 60;

function statusElement(): HTMLElement | null {
  return document.getElementById('status');
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Storage errors (a disabled or unavailable store) leave the save unread, so
// the game starts fresh rather than throwing before it can render.
function readSave(): { state: SimState; savedAt: number | null } | null {
  try {
    const raw = storage()?.getItem(SAVE_KEY) ?? null;
    if (raw === null) return null;
    const state = parseSavedState(raw);
    return state === null ? null : { state, savedAt: parseSavedAt(raw) };
  } catch {
    return null;
  }
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// The part of the stage the HUD and the shop leave open, so the island is framed inside it. The shop
// is a bottom sheet on a phone and a side panel on a wide screen; whichever it is, it is the edge it
// takes less of the stage from.
function safeArea(stage: HTMLElement, hud: HTMLElement | null, controls: HTMLElement | null): SafeArea {
  const box = stage.getBoundingClientRect();
  const safe: SafeArea = { top: 8, right: 8, bottom: 8, left: 8 };
  if (controls !== null) {
    const c = controls.getBoundingClientRect();
    const fromBottom = box.bottom - c.top;
    const fromRight = box.right - c.left;
    if (c.width < box.width * 0.6) safe.right = Math.max(safe.right, fromRight + 8);
    else safe.bottom = Math.max(safe.bottom, fromBottom + 6);
  }
  if (hud !== null) safe.top = Math.max(safe.top, hud.getBoundingClientRect().bottom - box.top + 4);
  return safe;
}

function start(): void {
  loadGameData()
    .then((data) => run(data))
    .catch((error: unknown) => {
      const status = statusElement();
      if (status !== null) status.textContent = LOAD_FAILED;
      console.error(error);
    });
}

function run(data: GameData): void {
  const { config, strings } = data;
  document.title = strings.tabTitle;
  statusElement()?.remove();
  const store = storage();
  const calm = reducedMotion();

  // The play seed is the wall-clock second the page opened, so strikes
  // roll differently per visit while the bot keeps its fixed seed.
  const seed = Math.floor(Date.now() / 1000) >>> 0;
  // A save credits the time since it was written, so dust keeps accruing while the page is closed.
  const save = readSave();
  const away = save === null || save.savedAt === null ? 0 : awaySeconds(save.savedAt, Date.now());
  const savedState = save === null ? null : away === 0 ? save.state : step(save.state, config, away);
  const welcome = save === null || savedState === null ? null : { gain: savedState.totalDust - save.state.totalDust, seconds: away };
  const initial = savedState ?? createSim(config, seed);

  const stage = document.getElementById('stage')!;
  const host = document.getElementById('game')!;
  const controlsRoot = document.getElementById('controls');
  const game = new Game(config, initial, store);
  const scene = new DustScene(host, config, calm);
  scene.setState(initial);
  const hud = new Hud(stage, config, strings, calm);
  const controls = controlsRoot === null ? null : new AccessibleControls(controlsRoot, config, strings, initial);
  controls?.attach(game);

  let clock = 0;
  game.listen({
    strike: (gain) => {
      const p = scene.pileScreen();
      hud.setAnchor(p.x, p.y);
      scene.strike(gain, hud.strike(gain));
    },
    bought: (unit, owned) => {
      scene.bought(unit, owned);
      hud.bought();
      controls?.bump(unit, clock);
    },
    unlocked: (rows) => {
      scene.unlocked();
      hud.unlocked(rows);
    },
  });

  // A tap anywhere on the island strikes; the Strike button does the same from the keyboard.
  scene.canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    game.act({ type: 'strike' });
  });

  const shareButton = document.getElementById('share');
  const shareStatus = document.getElementById('share-status');
  if (shareButton instanceof HTMLButtonElement && shareStatus !== null) {
    attachShare(shareButton, shareStatus, () => game.state, config, strings);
  }
  const seedButton = document.getElementById('seed-save');
  if (seedButton instanceof HTMLButtonElement && shareStatus !== null) {
    attachSeedButton(seedButton, shareStatus, () => game.state, config, strings);
  }

  // Framing: the island stays inside whatever the HUD and the shop leave open.
  let layoutDirty = true;
  const observer = new ResizeObserver(() => (layoutDirty = true));
  observer.observe(stage);
  if (controlsRoot !== null) observer.observe(controlsRoot);
  const hudNode = document.getElementById('hud');
  if (hudNode !== null) observer.observe(hudNode);
  const layout = (): void => {
    layoutDirty = false;
    const box = stage.getBoundingClientRect();
    const safe = safeArea(stage, hudNode, controlsRoot);
    scene.resize(box.width, box.height, safe);
    hud.placeBanner(safe.left + (box.width - safe.left - safe.right) / 2, safe.top + 6);
  };

  if (welcome !== null && welcome.seconds >= MIN_WELCOME_SECONDS && welcome.gain >= 1) {
    hud.welcome(welcome.gain, welcome.seconds);
    scene.welcome();
  }

  // Saving: every few seconds, when the tab is hidden and when the page goes away.
  window.setInterval(() => game.save(Date.now()), SAVE_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game.save(Date.now());
  });
  window.addEventListener('pagehide', () => game.save(Date.now()));

  // One loop: step the sim by wall-clock time, then draw the scene, the HUD and the controls from the
  // frame's clock. A hidden tab gets no frames, so nothing renders there; the step on return credits it.
  const frame = (ms: number): void => {
    clock = ms;
    if (layoutDirty) layout();
    const state = game.tick(Date.now());
    scene.setState(state);
    scene.frame(ms);
    const p = scene.pileScreen();
    hud.setAnchor(p.x, p.y);
    hud.frame(ms, state);
    controls?.update(state, true, ms);
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);

  // A seed link: offer it, never load it over the player's game without asking.
  const code = seedFromSearch(window.location.search);
  if (code !== null) handleSeedLink(code, data, game, save?.state ?? null, shareStatus);
}

function handleSeedLink(code: string, data: GameData, game: Game, own: SimState | null, status: HTMLElement | null): void {
  const clearLink = (): void => {
    const url = new URL(window.location.href);
    url.searchParams.delete('seed');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  };
  const seedState = decodeSeed(code);
  const dialog = document.getElementById('seed-offer');
  const store = storage();
  if (seedState === null || !(dialog instanceof HTMLDialogElement) || store === null) {
    if (status !== null) status.textContent = data.strings.seed.invalid;
    clearLink();
    return;
  }
  offerSeed(
    {
      dialog,
      title: document.getElementById('seed-offer-title')!,
      body: document.getElementById('seed-offer-body')!,
      replace: document.getElementById('seed-offer-replace')!,
      start: document.getElementById('seed-start') as HTMLButtonElement,
      keep: document.getElementById('seed-keep') as HTMLButtonElement,
    },
    seedState,
    own,
    data.config,
    data.strings,
    store,
    () => {
      game.stopSaving();
      clearLink();
      window.location.reload();
    },
    clearLink,
  );
}

// The next Dust card to fund, read apart from the game so a slow or failed read never holds it up.
function startNextCard(): void {
  const root = document.getElementById('next-card');
  const link = document.getElementById('next-card-link');
  const title = document.getElementById('next-card-title');
  const amount = document.getElementById('next-card-amount');
  const fill = document.getElementById('next-card-fill');
  if (root === null || !(link instanceof HTMLAnchorElement) || title === null || amount === null || fill === null) return;
  void loadNextCard().then((card) => showNextCard({ root, link, title, amount, fill }, card));
}

// What shipped for Dust since the last visit, for a returning player; read apart from the game too.
function startWhatsNew(): void {
  const root = document.getElementById('whats-new');
  const link = document.getElementById('whats-new-link');
  if (root === null || !(link instanceof HTMLAnchorElement)) return;
  const store = storage();
  if (store === null) return;
  void runWhatsNew({ root, link }, store, SAVE_KEY, Date.now());
}

start();
startNextCard();
startWhatsNew();
// One Dust load counted, with nothing that names the player (docs/specs/play-counts.md).
countEvent('dust_load');
