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
// A played state's save is a few hundred characters; anything far longer is not one of ours.
export const MAX_SEED_LENGTH = 4096;

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

/** The state a seed code holds, or null for anything that is not a valid seed of this save version. */
export function decodeSeed(code: string): SimState | null {
  if (typeof code !== 'string' || code.length > MAX_SEED_LENGTH) return null;
  const match = CODE.exec(code.trim());
  if (match === null || Number(match[1]) !== SAVE_VERSION) return null;
  const json = fromBase64Url(match[2]!);
  return json === null ? null : parseSavedState(json);
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
