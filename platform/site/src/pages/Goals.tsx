import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { Glyph, type GlyphName } from '../components/Glyph';
import { PageHeader } from '../components/PageHeader';
import { useCommunity } from '../lib/community';
import type { Goal, GoalsDoc } from '../lib/community-types';
import { copy } from '../lib/copy';
import { formatDate, formatUsd } from '../lib/format';
import { legal } from '../lib/legal';
import { labelOrder, visibleLabels } from '../lib/ticks';

// /goals (docs/specs/final-state.md, Goals): the studio's lifetime funding as one long track with
// its milestones, each a concrete outcome and its state: reached (with the date and what it
// delivered), next (with its bar) or later. Milestones are studio commitments from funds already in
// hand, never stretch promises. The figures come from /api/community/goals; when it does not answer
// the page says so and draws no track.

const STATES: Record<Goal['state'], { glyph: GlyphName; word: string }> = {
  reached: { glyph: 'check', word: copy.goals.states.reached },
  next: { glyph: 'flag', word: copy.goals.states.next },
  later: { glyph: 'clock', word: copy.goals.states.later },
};

function Track({ doc }: { doc: GoalsDoc }) {
  const top = Math.max(doc.lifetimeCents, ...doc.goals.map((goal) => goal.amountCents), 1);
  const at = (cents: number) => `${Math.min(100, (cents / top) * 100).toFixed(2)}%`;
  // Labels that would touch are hidden (lib/ticks.ts), measured after layout and again on resize.
  const track = useRef<HTMLDivElement>(null);
  const labels = useRef<(HTMLSpanElement | null)[]>([]);
  const [shown, setShown] = useState<readonly boolean[] | null>(null);
  const states = doc.goals.map((goal) => goal.state);
  const layoutKey = `${top}|${doc.goals.map((goal) => `${goal.id}:${goal.amountCents}:${goal.state}`).join(',')}`;
  useLayoutEffect(() => {
    const measure = () => {
      const boxes = states.map((_, i) => {
        const box = labels.current[i]?.getBoundingClientRect();
        return box === undefined ? { left: 0, right: 0 } : { left: box.left, right: box.right };
      });
      const next = visibleLabels(boxes, labelOrder(states));
      setShown((was) => (was !== null && was.length === next.length && was.every((value, i) => value === next[i]) ? was : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined' || track.current === null) return;
    const observer = new ResizeObserver(measure);
    observer.observe(track.current);
    return () => observer.disconnect();
    // The key holds everything the measure reads from the goals.
  }, [layoutKey]);
  return (
    <div className="goals-track" ref={track}>
      <div
        className="funding-bar"
        role="progressbar"
        aria-label={copy.goals.trackLabel}
        aria-valuemin={0}
        aria-valuemax={top / 100}
        aria-valuenow={doc.lifetimeCents / 100}
        aria-valuetext={copy.goals.trackValue.replace('{amount}', formatUsd(doc.lifetimeCents / 100))}
      >
        {doc.lifetimeCents > 0 ? <div className="funding-bar-fill" style={{ '--fill': at(doc.lifetimeCents) } as CSSProperties} /> : null}
      </div>
      <ol className="goals-ticks" aria-hidden="true">
        {doc.goals.map((goal, i) => (
          <li key={goal.id} data-state={goal.state} style={{ '--at': at(goal.amountCents) } as CSSProperties}>
            <span className="goals-tick" />
            <span
              className="goals-tick-label"
              ref={(element) => {
                labels.current[i] = element;
              }}
              data-hidden={shown !== null && shown[i] === false ? 'true' : undefined}
            >
              {formatUsd(goal.amountCents / 100)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Milestone({ goal }: { goal: Goal }) {
  const state = STATES[goal.state];
  const link = goal.link;
  return (
    <li className="goal" data-state={goal.state}>
      <p className="goal-rail">
        <span className="tag">
          <Glyph name={state.glyph} />
          {state.word}
        </span>
        <span className="goal-amount">{formatUsd(goal.amountCents / 100)}</span>
      </p>
      <div className="goal-text">
        <h3>{goal.title}</h3>
        <p>{goal.outcome}</p>
        <p className="goal-meta">
          {goal.state === 'reached' && goal.reachedAt !== null ? <span>{copy.goals.reachedOn.replace('{date}', formatDate(goal.reachedAt))}</span> : null}
          {link === null ? null : link.startsWith('/') ? <Link to={link}>{copy.goals.seeWhat}</Link> : <a href={link}>{copy.goals.seeWhat}</a>}
        </p>
      </div>
    </li>
  );
}

export function Goals() {
  const doc = useCommunity<GoalsDoc>('/goals');
  const goals = doc.state === 'ready' ? [...doc.data.goals].sort((a, b) => a.amountCents - b.amountCents) : [];
  const next = goals.find((goal) => goal.state === 'next') ?? null;
  return (
    <main className="wide sheet">
      <div className="band">
        <PageHeader title={copy.goals.title} lede={copy.goals.lede} />
      </div>
      <div className="band">
        <section className="section" aria-labelledby="goals-track">
          <h2 id="goals-track">{copy.goals.trackTitle}</h2>
          {doc.state === 'loading' ? (
            <p className="muted" aria-busy="true">
              {copy.goals.loading}
            </p>
          ) : doc.state === 'unavailable' ? (
            <EmptyState line={legal.partUnavailable} next={{ to: '/ledger', label: copy.emptyState.ledger }} unavailable onRetry={doc.reload} />
          ) : (
            <>
              <p className="goals-lifetime">
                <span className="goals-figure">{formatUsd(doc.data.lifetimeCents / 100)}</span> {copy.goals.lifetime}
                {next === null ? null : (
                  <>
                    {' '}
                    {copy.goals.nextLine
                      .replace('{title}', next.title)
                      .replace('{left}', formatUsd(Math.max(0, next.amountCents - doc.data.lifetimeCents) / 100))}
                  </>
                )}
              </p>
              {/* With no milestone the track would measure the total against itself and draw full, as
                  if a goal were reached, so it waits for the first milestone. */}
              {goals.length === 0 ? (
                <p className="muted">{copy.goals.none}</p>
              ) : (
                <>
                  <Track doc={{ ...doc.data, goals }} />
                  <ol className="goals-list">
                    {goals.map((goal) => (
                      <Milestone key={goal.id} goal={goal} />
                    ))}
                  </ol>
                </>
              )}
            </>
          )}
        </section>
        <section className="section" aria-labelledby="goals-rules">
          <h2 id="goals-rules">{copy.goals.rulesTitle}</h2>
          <ul className="plain-list">
            {copy.goals.rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
          <p>
            <Link to="/ledger">{copy.goals.ledgerLink}</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
