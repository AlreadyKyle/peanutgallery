import { useEffect, useRef, useState } from 'react';
import { LONGEST_UPDATES_LABEL, shouldAnnounceCount, updatesLabel } from '../lib/changes';
import { copy } from '../lib/copy';
import { Glyph } from './Glyph';

/**
 * The one polite announcer: funded and shipped cards, and the waiting count, are said here once.
 * It is always in the page, so a screen reader hears text as it arrives.
 */
export function Announcer({ message }: { message: string }) {
  return (
    <p className="sr-only" role="status" aria-live="polite" data-announcer="">
      {message}
    </p>
  );
}

/**
 * The live-updates row, laid out from first paint: "Pause live updates" (a toggle) first, then the
 * updates button. The updates button is always there. With nothing waiting it reads "Up to date" and
 * is aria-disabled, never disabled, so it keeps focus; with changes waiting it reads "Show n updates".
 * Both labels share one cell with the longest one hidden, so its width never changes and nothing
 * beside or below it moves. After a press it goes back to "Up to date" in place, with focus kept.
 */
export function LiveUpdates({
  count,
  paused,
  onTogglePause,
  onShow,
  message = '',
  now = () => Date.now(),
}: {
  count: number;
  paused: boolean;
  onTogglePause: () => void;
  onShow: () => void;
  /** Words for the announcer from the page: a card that was funded or shipped. */
  message?: string;
  now?: () => number;
}) {
  const waiting = count > 0;
  const [announcement, setAnnouncement] = useState('');
  const previous = useRef(count);
  const lastAnnounced = useRef<number | null>(null);

  useEffect(() => {
    const at = now();
    if (shouldAnnounceCount(previous.current, count, lastAnnounced.current, at)) {
      lastAnnounced.current = at;
      setAnnouncement(copy.updatesWaiting);
    }
    previous.current = count;
    // The clock is read when the count changes, not watched.
  }, [count]);

  useEffect(() => {
    if (message !== '') setAnnouncement(message);
  }, [message]);

  return (
    <div className="live-updates">
      <button type="button" className="button button-secondary" aria-pressed={paused} onClick={onTogglePause}>
        {paused ? <Glyph name="check" /> : null}
        {copy.pauseLiveUpdates}
      </button>
      <button
        type="button"
        className={waiting ? 'button updates-button' : 'button button-quiet updates-button'}
        aria-disabled={waiting ? undefined : 'true'}
        onClick={() => {
          if (waiting) onShow();
        }}
      >
        <span className="label-stack">
          <span>{updatesLabel(count)}</span>
          <span aria-hidden="true">{LONGEST_UPDATES_LABEL}</span>
        </span>
      </button>
      {paused ? <p className="live-updates-note">{copy.liveUpdatesPaused}</p> : null}
      <Announcer message={announcement} />
    </div>
  );
}
