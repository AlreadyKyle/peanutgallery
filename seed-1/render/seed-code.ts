// Seeds (docs/specs/final-state.md, Seeds and instances): a saved run anyone can open, as a short code
// `dust:v<saveVersion>:<base64url(save JSON)>` and a link https://play.mobmachine.games/?seed=<code>.
// Three-free and DOM-free, so tests/seed-code.test.ts runs it in Node. The save JSON is the same
// wrapper sim/save.ts writes (without savedAt: a seed is a state, not a moment, so opening one credits
// no time away), and decoding goes through parseSavedState, so a seed can never load a state a save
// could not.
import { parseSavedState, SAVE_VERSION, serializeState } from '../sim/save';
import type { SimState } from '../sim/types';

export const SEED_GAME = 'dust';
export const SEED_PARAM = 'seed';
export const PLAY_URL = 'https://play.mobmachine.games/';
// The site's seed gallery: it saves a seed to the signed-in player's profile from `?save=<code>`.
export const GALLERY_URL = 'https://mobmachine.games/seeds';
export const GALLERY_PARAM = 'save';
// A played state's save is a few hundred characters; anything far longer is not one of ours.
export const MAX_SEED_LENGTH = 4096;

// The most a seed may hold. A save only has to be finite, but a seed comes from anyone's hand, and a
// crafted one (1e301 dust) would load a run the sim never reaches, whose numbers the screen cannot
// show and whose next press gives gems by the googol. These sit far past any played run: dust below
// the figure where the screen switches to an exponent (render/format.ts), a few hundred units of a
// kind at most (each costs 1.25 times the last), and counts that take lifetimes to earn.
export const SEED_LIMITS = {
  dust: 1e21,
  owned: 1000,
  gems: 1e7,
  season: 1e5,
  ordersFilled: 1e6,
  elapsedSeconds: 1e9,
} as const;

/** Whether a decoded state is one a played run could hold (SEED_LIMITS); lifetime dust is never less than dust. */
export function seedIsPlausible(state: SimState): boolean {
  const dusts = [state.dust, state.totalDust, state.pastDust ?? 0, state.order?.target ?? 0, state.order?.progress ?? 0];
  if (dusts.some((value) => value >= SEED_LIMITS.dust)) return false;
  // Dust is only ever added to both or spent, so it never runs ahead of lifetime dust (a whole dust of slack for rounding).
  if (state.dust > state.totalDust + 1) return false;
  if (Object.values(state.owned).some((count) => count > SEED_LIMITS.owned)) return false;
  if ((state.gems ?? 0) > SEED_LIMITS.gems || (state.season ?? 0) > SEED_LIMITS.season) return false;
  if ((state.ordersFilled ?? 0) > SEED_LIMITS.ordersFilled) return false;
  if (state.elapsedSeconds > SEED_LIMITS.elapsedSeconds) return false;
  return state.unlocked.every((event) => event.atSeconds >= 0 && event.atSeconds <= SEED_LIMITS.elapsedSeconds);
}

const CODE = /^dust:v(\d{1,4}):([A-Za-z0-9_-]+)$/;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code: string): string | null {
  try {
    const padded = code.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (code.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** The seed code for a state: `dust:v1:<base64url>`. */
export function encodeSeed(state: SimState): string {
  return `${SEED_GAME}:v${SAVE_VERSION}:${toBase64Url(serializeState(state))}`;
}

/**
 * The state a seed code holds, or null for anything that is not a valid seed of this save version or
 * holds more than a played run could (seedIsPlausible).
 */
export function decodeSeed(code: string): SimState | null {
  if (typeof code !== 'string' || code.length > MAX_SEED_LENGTH) return null;
  const match = CODE.exec(code.trim());
  if (match === null || Number(match[1]) !== SAVE_VERSION) return null;
  const json = fromBase64Url(match[2]!);
  const state = json === null ? null : parseSavedState(json);
  return state !== null && seedIsPlausible(state) ? state : null;
}

/** The link that opens a seed: the game's address with `?seed=<code>`. The code's characters need no escaping. */
export function seedLink(code: string, base = PLAY_URL): string {
  return `${base}?${SEED_PARAM}=${code}`;
}

/** The seed code in a page's query string (`location.search`), or null when there is none. */
export function seedFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get(SEED_PARAM);
  return value === null || value === '' ? null : value;
}

/** The link that saves a seed to the gallery: https://mobmachine.games/seeds?save=<code>. */
export function galleryLink(code: string, base = GALLERY_URL): string {
  const url = new URL(base);
  url.searchParams.set(GALLERY_PARAM, code);
  return url.toString();
}
