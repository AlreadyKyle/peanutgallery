import { legal } from '../lib/legal';
import type { Snapshot } from '../lib/source';
import type { StudioState } from '../lib/studio';

/** True only once the studio row has loaded and says the agents are paused; a failed read never claims a pause. */
export function isPaused(studio: StudioState): boolean {
  return studio.state === 'ready' && !studio.snapshot.missing.includes('studio') && studio.snapshot.paused;
}

/**
 * The one sentence the site says while the agents are paused, on home's status line and in this
 * notice alike: the reason's sentence from legal.pauseReasons, or the general line when the reason
 * is missing or has no sentence. Null when not paused or when the studio row did not load. It names
 * the category only, never who paused or when (docs/specs/money-surfaces.md).
 */
export function pausedSentence(snapshot: Snapshot): string | null {
  if (snapshot.missing.includes('studio') || !snapshot.paused) return null;
  const reason = snapshot.pauseReason ?? null;
  return (reason === null ? undefined : legal.pauseReasons[reason]) ?? legal.pausedNotice;
}

/** One plain line while the agents are paused, saying why. */
export function PausedNotice({ studio }: { studio: StudioState }) {
  const sentence = studio.state === 'ready' ? pausedSentence(studio.snapshot) : null;
  return sentence === null ? null : <p className="notice">{sentence}</p>;
}
