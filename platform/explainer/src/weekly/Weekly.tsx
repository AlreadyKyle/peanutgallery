import { AbsoluteFill, Audio, staticFile, useCurrentFrame } from 'remotion';
import { C } from '../theme';
import { WEEKLY } from './geometry';
import { layout } from './layout';
import { Plate } from './Plate';
import type { WeeklyInput } from './schema';
import { Scenes } from './Scenes';
import { WEEKS } from './weeks';
import { Words } from './Words';

// The weekly update video (docs/specs/weekly-video.md): the explainer's plate and top bar, then each
// segment's beats, the words on one side and a drawn scene acting out the change on the other, then the closing plate. The week is data (weeks/); the rects come from the capture script.

export function Weekly({ format, week: id, rects = {} }: WeeklyInput) {
  const frame = useCurrentFrame();
  const week = WEEKS[id];
  if (week === undefined) throw new Error(`no week ${id} in src/weekly/weeks`);
  const g = WEEKLY[format];
  const plan = layout(week);
  const base = `weekly/${week.date}`;
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <Scenes frame={frame} g={g} plan={plan} />
      <Words frame={frame} g={g} plan={plan} weekLabel={week.label} />
      <Plate frame={frame} g={g} plan={plan} week={week} />
      <Audio src={staticFile(`weekly-soundtrack-${week.date}.wav`)} />
    </AbsoluteFill>
  );
}
