import { Composition } from 'remotion';
import { Explainer } from './Explainer';
import './fonts';
import { FORMATS } from './format';
import './styles.css';
import { DURATION, FPS } from './timeline';

export function Root() {
  return (
    <>
      {Object.values(FORMATS).map((format) => (
        <Composition key={format.id} id={format.id} component={Explainer} durationInFrames={DURATION} fps={FPS} width={format.width} height={format.height} defaultProps={{ format: format.name, social: false }} />
      ))}
    </>
  );
}
