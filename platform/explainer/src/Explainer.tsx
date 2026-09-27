import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { at } from './anim';
import { Caption } from './components/Caption';
import { Closing } from './components/Closing';
import { TopBar } from './components/TopBar';
import { script, stepHeadings } from './data';
import { FORMATS, type FormatName } from './format';
import { Intro } from './scenes/Intro';
import { Journey } from './scenes/Journey';
import { Ledger } from './scenes/Ledger';
import { Team } from './scenes/Team';
import { C } from './theme';
import { CHOREO, SCENES, sceneLength, sceneStart } from './timeline';

// The whole video: the paper ground, each scene's stage, each scene's words, the black plate and top
// bar over them, and the soundtrack the score renders from the same timeline.

/** `social` adds the site's address to the closing plate, for the cuts posted off the site. */
export type ExplainerProps = { format: FormatName; social?: boolean };

export function Explainer({ format: name, social = false }: ExplainerProps) {
  const frame = useCurrentFrame();
  const format = FORMATS[name];
  const journeyStart = sceneStart('pick');
  const journeyEnd = sceneStart('ledger');
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <Sequence from={sceneStart('intro')} durationInFrames={sceneLength('intro')} layout="none">
        <Intro format={format} />
      </Sequence>
      <Sequence from={sceneStart('team')} durationInFrames={sceneLength('team')} layout="none">
        <Team format={format} />
      </Sequence>
      <Sequence from={journeyStart} durationInFrames={journeyEnd - journeyStart} layout="none">
        <Journey format={format} />
      </Sequence>
      <Sequence from={sceneStart('ledger')} durationInFrames={sceneLength('ledger')} layout="none">
        <Ledger format={format} />
      </Sequence>

      {SCENES.filter((scene) => scene.id !== 'outro').map((scene) => {
        const beat = script.beats[scene.beat]!;
        const start = sceneStart(scene.id);
        const moments = CHOREO[scene.id];
        const lineAt = at('line' in moments ? moments.line : 0);
        const number = beat.step === null ? -1 : stepHeadings.indexOf(beat.step);
        return (
          <Sequence key={scene.id} from={start} durationInFrames={sceneLength(scene.id)} layout="none">
            <Caption
              text={beat.line}
              step={beat.step === null ? null : { number: number + 1, heading: beat.step }}
              frame={frame - start}
              start={lineAt}
              end={sceneLength(scene.id)}
              format={format}
            />
          </Sequence>
        );
      })}

      <TopBar frame={frame} format={format} social={social} />

      <Sequence from={sceneStart('outro')} durationInFrames={sceneLength('outro')} layout="none">
        <Closing frame={frame - sceneStart('outro')} format={format} social={social} />
      </Sequence>

      <Audio src={staticFile('soundtrack.wav')} />
    </AbsoluteFill>
  );
}
