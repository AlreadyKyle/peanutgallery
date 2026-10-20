import { Composition } from 'remotion';
import { Explainer } from './Explainer';
import './fonts';
import { FORMATS } from './format';
import './styles.css';
import { DURATION, FPS } from './timeline';
import { WEEKLY } from './weekly/geometry';
import { layout } from './weekly/layout';
import type { WeeklyInput } from './weekly/schema';
import { Weekly } from './weekly/Weekly';
import { LATEST, WEEKS } from './weekly/weeks';

export function Root() {
  return (
    <>
      {Object.values(FORMATS).map((format) => (
        <Composition key={format.id} id={format.id} component={Explainer} durationInFrames={DURATION} fps={FPS} width={format.width} height={format.height} defaultProps={{ format: format.name, social: false }} />
      ))}
      {Object.values(WEEKLY).map((g) => (
        <Composition
          key={g.id}
          id={g.id}
          component={Weekly}
          durationInFrames={layout(WEEKS[LATEST]!).duration}
          fps={FPS}
          width={g.format.width}
          height={g.format.height}
          defaultProps={{ format: g.format.name, week: LATEST, rects: {} } satisfies WeeklyInput}
          calculateMetadata={({ props }) => ({ durationInFrames: layout(WEEKS[props.week]!).duration })}
        />
      ))}
    </>
  );
}
