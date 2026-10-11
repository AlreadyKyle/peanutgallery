import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { fetchPlayCounts, PLAY_COUNT_DAYS, PLAY_EVENTS, type PlayCountDay } from './lib/board';
import { errorMessage } from './lib/supabase';

/** The column heads, in PLAY_EVENTS order. */
export const PLAY_COUNT_HEADS: Record<(typeof PLAY_EVENTS)[number], string> = {
  dust_load: 'Dust loads',
  dust_share: 'Share your run',
  card_share: 'Card shares',
  dust_next_card: 'Dust to a card',
};

export const PLAY_COUNTS_LINE =
  'Daily totals by UTC day, counted with no cookie, no identifier and no address, so one person can count more than once.';

/**
 * Play and share counts (docs/specs/play-counts.md): the last PLAY_COUNT_DAYS days, today first, with
 * the period's total. It reads once when the panel opens; it never polls.
 */
export function PlayCounts({ client }: { client: SupabaseClient }) {
  const [days, setDays] = useState<PlayCountDay[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    fetchPlayCounts(client)
      .then((next) => {
        if (live) setDays(next);
      })
      .catch((reason: unknown) => {
        if (live) setError(errorMessage(reason));
      });
    return () => {
      live = false;
    };
  }, [client]);

  const total = (event: (typeof PLAY_EVENTS)[number]) => (days ?? []).reduce((sum, day) => sum + day[event], 0);

  return (
    <section aria-label="Play and share counts">
      <h2>Play and share counts</h2>
      <p className="muted">{PLAY_COUNTS_LINE}</p>
      {error !== '' ? <p className="error">{error}</p> : null}
      {days === null && error === '' ? <p role="status">Loading the counts.</p> : null}
      {days === null ? null : (
        <div className="table-scroll">
          <table>
            <caption>The last {PLAY_COUNT_DAYS} days</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                {PLAY_EVENTS.map((event) => (
                  <th scope="col" key={event}>
                    {PLAY_COUNT_HEADS[event]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.day} data-day={day.day}>
                  <th scope="row">{day.day}</th>
                  {PLAY_EVENTS.map((event) => (
                    <td key={event}>{day[event]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr data-day="total">
                <th scope="row">Total</th>
                {PLAY_EVENTS.map((event) => (
                  <td key={event}>{total(event)}</td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
