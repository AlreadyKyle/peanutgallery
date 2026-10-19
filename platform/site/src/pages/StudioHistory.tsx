import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Glyph } from '../components/Glyph';
import { PageHeader } from '../components/PageHeader';
import { RoomDrawing, viewBoxOf } from '../components/RoomDrawing';
import { useCommunity } from '../lib/community';
import type { StudioDoc, StudioEra } from '../lib/community-types';
import { copy } from '../lib/copy';
import { formatDate } from '../lib/format';
import { legal } from '../lib/legal';
import { eraKey, roomPlan } from '../lib/studio-scene';

// /studio/history (docs/specs/final-state.md, Studio evolution and history): every era the studio
// reached, kept as a blueprint: the room as line drawings on the blueprint ground, with what changed,
// when, and what unlocked it, and a slider to move through them. The eras come from
// /api/community/studio; when it does not answer, the page says so and draws the garage the live
// studio falls back to, named as that and nothing more.

/** An era's stations or decor in words: "test bench", never the id test_bench. */
function partsLine(ids: readonly string[]): string {
  return ids.length === 0 ? copy.history.none : ids.map((id) => copy.history.parts[id] ?? id.replaceAll('_', ' ')).join(', ');
}

function Blueprint({ era }: { era: StudioEra | null }) {
  const plan = roomPlan(eraKey(era), era !== null && era.decor.length > 0 ? era.decor : undefined);
  const vb = viewBoxOf(plan);
  return (
    <svg className="room blueprint-room" data-variant="blueprint" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} role="img" aria-label={copy.history.drawingLabel.replace('{era}', era?.name ?? copy.studioRoom.eras.garage)}>
      <RoomDrawing plan={plan} />
    </svg>
  );
}

export function StudioHistory() {
  const doc = useCommunity<StudioDoc>('/studio');
  const eras = doc.state === 'ready' ? [...doc.data.eras].sort((a, b) => a.index - b.index) : [];
  const current = doc.state === 'ready' ? eras.findIndex((era) => era.id === doc.data.era.id) : -1;
  const [index, setIndex] = useState<number | null>(null);
  const id = useId();
  useEffect(() => {
    if (index === null && current >= 0) setIndex(current);
  }, [current, index]);
  const at = index ?? Math.max(0, current);
  const era = eras[at] ?? null;
  return (
    <main className="wide">
      <div className="band">
        <PageHeader title={copy.history.title} lede={copy.history.lede} />
      </div>
      <div className="band">
        <section className="section" aria-labelledby="history-eras">
          <h2 id="history-eras">{copy.history.erasTitle}</h2>
          {doc.state === 'loading' ? (
            <p className="muted" aria-busy="true">
              {copy.history.loading}
            </p>
          ) : null}
          {doc.state === 'unavailable' ? <p className="muted">{legal.partUnavailable} {copy.history.fallback}</p> : null}
          <div className="blueprint">
            <div className="blueprint-head">
              <p className="blueprint-era">
                <span className="blueprint-index">{copy.history.eraNumber.replace('{n}', String((era?.index ?? 0) + 1))}</span>
                <span className="blueprint-name">{era?.name ?? copy.studioRoom.eras.garage}</span>
              </p>
              {era === null ? null : (
                <p className="blueprint-when">
                  {era.reachedAt === null ? copy.history.notReached : copy.history.reachedOn.replace('{date}', formatDate(era.reachedAt))}
                </p>
              )}
            </div>
            <Blueprint era={era} />
            {era === null ? null : (
              <dl className="blueprint-facts">
                <div>
                  <dt>{copy.history.unlockedBy}</dt>
                  <dd>{era.unlockedBy}</dd>
                </div>
                <div>
                  <dt>{copy.history.stations}</dt>
                  <dd>{partsLine(era.stations)}</dd>
                </div>
                <div>
                  <dt>{copy.history.decor}</dt>
                  <dd>{partsLine(era.decor)}</dd>
                </div>
              </dl>
            )}
          </div>
          {eras.length > 1 ? (
            <div className="era-stepper">
              <button type="button" className="button button-secondary" onClick={() => setIndex(Math.max(0, at - 1))} disabled={at === 0}>
                <Glyph name="arrow-left" />
                {copy.history.earlier}
              </button>
              <label className="sr-only" htmlFor={`${id}-range`}>
                {copy.history.sliderLabel}
              </label>
              <input
                id={`${id}-range`}
                className="era-range"
                type="range"
                min={0}
                max={eras.length - 1}
                step={1}
                value={at}
                aria-valuetext={era?.name}
                onChange={(event) => setIndex(Number(event.currentTarget.value))}
              />
              <button type="button" className="button button-secondary" onClick={() => setIndex(Math.min(eras.length - 1, at + 1))} disabled={at === eras.length - 1}>
                {copy.history.later}
                <Glyph name="arrow-right" />
              </button>
            </div>
          ) : null}
          {eras.length > 0 ? (
            <ol className="rows era-rows">
              {eras.map((item, i) => (
                <li key={item.id} aria-current={i === at ? 'true' : undefined}>
                  <button type="button" className="era-pick" onClick={() => setIndex(i)} aria-pressed={i === at}>
                    {i === at ? <Glyph name="check" /> : null}
                    {item.name}
                  </button>
                  <span className="muted small">{item.reachedAt === null ? copy.history.notReached : formatDate(item.reachedAt)}</span>
                </li>
              ))}
            </ol>
          ) : null}
          <p>
            <Link to="/goals">{copy.history.goalsLink}</Link>
          </p>
        </section>
      </div>
    </main>
  );
}
