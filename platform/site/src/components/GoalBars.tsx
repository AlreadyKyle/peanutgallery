import { copy } from '../lib/copy';
import { formatUsd, percent } from '../lib/format';
import type { StudioState } from '../lib/studio';

export function GoalBars({ studio }: { studio: StudioState }) {
  return (
    <>
      <Goals studio={studio} />
      <p>{copy.poolTotal}</p>
    </>
  );
}

function Goals({ studio }: { studio: StudioState }) {
  if (studio.state === 'loading') {
    return <p>Loading the sprint goals.</p>;
  }
  if (studio.state !== 'ready') {
    return <p>{copy.meterUnavailable}</p>;
  }
  const { goals } = studio.snapshot;
  if (goals.length === 0) {
    return <p>{copy.goalsEmpty}</p>;
  }
  return (
    <ul className="goals">
      {goals.map((goal) => {
        const filled = percent(goal.funded_usd, goal.funding_target_usd);
        return (
          <li key={goal.id}>
            <div className="goal-head">
              <span>{goal.title}</span>
              <span>
                {formatUsd(goal.funded_usd)} of {formatUsd(goal.funding_target_usd)}
              </span>
            </div>
            <div
              className="bar"
              role="progressbar"
              aria-label={goal.title}
              aria-valuemin={0}
              aria-valuemax={goal.funding_target_usd}
              aria-valuenow={goal.funded_usd}
            >
              <div className="bar-fill" style={{ width: `${filled}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
