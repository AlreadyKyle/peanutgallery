import { useCurrentFrame } from 'remotion';
import { SUITS } from '../../../site/src/components/Glyph';
import { at, pop, progress } from '../anim';
import { Glyph } from '../components/Glyph';
import { Phone, PHONE } from '../components/Phone';
import { At, Stage } from '../components/Stage';
import type { Format } from '../format';
import { C, EASE_IN } from '../theme';
import { CHOREO } from '../timeline';

// After the plate folds away: the game itself, a real frame of it on a phone, with the game suit's
// cartridge stuck on beside it. No game is named (PLAN.md §10 decision 57).
export function Intro({ format }: { format: Format }) {
  const frame = useCurrentFrame();
  const c = CHOREO.intro;
  const rise = pop(frame, at(c.phone), 'soft');
  const tag = pop(frame, at(c.tag), 'bouncy');
  const out = progress(frame, at(c.exit), 45, EASE_IN);
  const phoneY = 450 + (1 - rise) * 1100 + out * 1000;
  return (
    <Stage format={format}>
      <At x={450} y={phoneY} w={PHONE.width} h={PHONE.height} scale={1.08} rotate={(1 - rise) * 6 - out * 4}>
        <Phone frame={frame} style={{ left: 0, top: 0 }} />
      </At>
      <At x={450 + 205} y={phoneY - 255} w={96} h={96} scale={tag} rotate={-8 + 8 * out} opacity={1 - out}>
        <div style={{ display: 'grid', placeItems: 'center', width: 96, height: 96, boxSizing: 'border-box', borderRadius: 18, border: `4px solid ${C.ink}`, background: C.suitGame, color: C.paper }}>
          <Glyph name={SUITS.game.glyph} size={60} />
        </div>
      </At>
    </Stage>
  );
}
