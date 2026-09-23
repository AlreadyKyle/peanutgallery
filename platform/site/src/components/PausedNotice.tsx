import { legal } from '../lib/legal';
import type { StudioState } from '../lib/studio';

/** True only once the studio row has loaded and says the agents are paused; a failed read never claims a pause. */
export function isPaused(studio: StudioState): boolean {
  return studio.state === 'ready' && !studio.snapshot.missing.includes('studio') && studio.snapshot.paused;
}

/** One plain line while the board has paused the agents, true whatever the reason for the pause. */
export function PausedNotice({ studio }: { studio: StudioState }) {
  return isPaused(studio) ? <p className="notice">{legal.pausedNotice}</p> : null;
}
