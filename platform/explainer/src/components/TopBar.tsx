import { at, progress, tween } from '../anim';
import { labels } from '../data';
import type { Format } from '../format';
import { C, EASE_IN_OUT, FONT } from '../theme';
import { BAR, CHOREO, SCENES, sceneStart, type SceneId } from '../timeline';
import { Mark, type MarkTimes } from './Mark';

// The black plate, as on the site: every page opens on it. The video opens on the plate with the
// mark built up in the middle, folds the plate up into the site's top bar (the mark and the wordmark
// move with it), carries the step counter on the bar's right while the six steps play, and unfolds
// it again to close.

const FOLD = 54;
const STEPS: readonly SceneId[] = ['pick', 'split', 'fills', 'build', 'checks', 'shipped'];

function measure(text: string, size: number): number {
  const canvas = document.createElement('canvas').getContext('2d');
  if (canvas === null) return text.length * size * 0.68;
  canvas.font = `700 ${size}px ${FONT}`;
  return canvas.measureText(text).width;
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

/** The plate's lockup, the mark over the wordmark, and where it sits on the opening plate. */
export function plateLockup(format: Format) {
  const P = format.mark.plate;
  const gap = 52;
  const word = format.name === 'wide' ? 92 : 80;
  const height = P + gap + word;
  return { P, gap, word, height, top: (format.height - height) / 2 };
}

/** The closing line under the lockup: its type size, line height, and the room it takes. */
export function closingLines(format: Format, social: boolean) {
  const size = format.name === 'wide' ? 62 : 56;
  const line = Math.round(size * 1.32);
  const gap = 64;
  const address = social ? 28 + Math.round(size * 0.6 * 1.3) : 0;
  return { size, line, gap, address, height: gap + line * 3 + address };
}

/** On the closing plate the lockup and the line under it are centred together. */
export function closingTop(format: Format, social: boolean): number {
  const lockup = plateLockup(format);
  return (format.height - lockup.height - closingLines(format, social).height) / 2;
}

export function TopBar({ frame, format, social = false }: { frame: number; format: Format; social?: boolean }) {
  const { width: W, height: H, bar, margin } = format;
  const fold = progress(frame, at(CHOREO.intro.collapse), FOLD, EASE_IN_OUT);
  const unfold = progress(frame, sceneStart('outro') + at(CHOREO.outro.expand), FOLD, EASE_IN_OUT);
  const k = fold - unfold; // 0 is the full plate, 1 is the top bar
  const height = lerp(H, bar, k);

  const lockup = plateLockup(format);
  const plateWord = lockup.word;
  const barWord = 26;
  // Measured on every frame, never cached, so no frame keeps a width taken before the font loaded.
  const wordWidth = measure(labels.wordmark, plateWord);

  // The lockup on the plate: the mark over the wordmark, centred; on the closing plate it rises so it
  // and the closing line under it are centred together.
  const { P, gap } = lockup;
  const plateTop = lerp(lockup.top, closingTop(format, social), unfold);
  const b = format.mark.bar;
  // The mark and the wordmark take different curves, so they never cross: the mark heads left first
  // and the wordmark rises after it has cleared, landing to its right.
  const markH = lerp(P, b, k);
  const markLeft = lerp(W / 2 - (P * 0.8) / 2, margin, Math.pow(k, 0.6));
  const markTop = lerp(plateTop, (bar - b) / 2, k);
  const wordScale = lerp(1, barWord / plateWord, k);
  const wordLeft = lerp(W / 2 - wordWidth / 2, margin + b * 0.8 + 20, Math.pow(k, 1.4));
  const wordTop = lerp(plateTop + P + gap, bar / 2 - (barWord * 1.0) / 2, Math.pow(k, 1.8));

  const times: MarkTimes = {
    cabinet: at(CHOREO.intro.cabinet),
    screen: at(CHOREO.intro.screen),
    eyes: [at(CHOREO.intro.eyes[0]), at(CHOREO.intro.eyes[1])],
    slot: at(CHOREO.intro.slot),
    glance: at(CHOREO.intro.glance),
    blink: at(CHOREO.intro.blink),
  };
  // The mark blinks as each step starts, and once more on the closing plate.
  const blinks = [...STEPS.map((id) => sceneStart(id) + 6), sceneStart('outro') + at(CHOREO.outro.blink)];

  const wordStart = at(CHOREO.intro.word);
  const letters = labels.wordmark.split('');

  // The step counter: which of the six steps is on screen.
  const stepIndex = STEPS.findIndex((id) => {
    const start = sceneStart(id);
    const scene = SCENES.find((s) => s.id === id)!;
    return frame >= start && frame < start + scene.bars * BAR;
  });
  const railIn = progress(frame, sceneStart('pick') - 24, 24) - progress(frame, sceneStart('ledger'), 24);

  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: W, height, background: C.ink, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: markLeft, top: markTop }}>
        <Mark height={markH} colour={C.paper} ground={C.ink} frame={frame} times={times} blinks={blinks} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: wordLeft,
          top: wordTop,
          transform: `scale(${wordScale})`,
          transformOrigin: 'top left',
          fontFamily: FONT,
          fontWeight: 700,
          fontSize: plateWord,
          lineHeight: 1,
          color: C.paper,
          whiteSpace: 'pre',
        }}
      >
        {letters.map((letter, i) => {
          const t = wordStart + i * 2;
          return (
            <span key={i} style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top' }}>
              <span style={{ display: 'inline-block', transform: `translateY(${tween(frame, t, 18, 110, 0)}%)` }}>{letter}</span>
            </span>
          );
        })}
      </div>
      {railIn > 0 ? (
        <div style={{ position: 'absolute', right: margin, top: (bar - 38) / 2, display: 'flex', gap: 10, opacity: railIn, fontFamily: FONT }}>
          {STEPS.map((id, i) => {
            const active = i === stepIndex;
            const done = stepIndex > i;
            const on = active ? progress(frame, sceneStart(id), 12) : 0;
            return (
              <span
                key={id}
                style={{
                  display: 'inline-grid',
                  placeItems: 'center',
                  width: 38,
                  height: 38,
                  boxSizing: 'border-box',
                  borderRadius: 8,
                  border: `2px solid ${active || done ? C.paper : C.lineOnInk}`,
                  background: active ? C.paper : 'transparent',
                  color: active ? C.ink : done ? C.paper : C.mutedOnInk,
                  fontSize: 19,
                  fontWeight: 700,
                  transform: `scale(${1 + 0.12 * Math.sin(on * Math.PI)})`,
                }}
              >
                {i + 1}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
