import type { CSSProperties } from 'react';
import { Img, staticFile } from 'remotion';
import { progress, tween } from '../anim';
import { C, DUST_BACKGROUND, EASE_IN_OUT } from '../theme';

// The game on a phone: a real frame of it (seed-1's frames rig, the sim at 3,600 seconds, 332 by 694),
// drawn at 300 wide inside a plain ink frame. The frame starts below the game's title and dust count,
// since the video names no game (PLAN.md §10 decision 57). The play bot is a pointer that taps the
// game's own buttons; each tap presses the button and rings out.

export const SCREEN = { width: 300, height: Math.round((694 * 300) / 332) } as const;
const K = 300 / 332;
/** Rows of the frame's own pixels cut from its top: the game's title and its dust count. */
const CROP = 92;
const BORDER = 12;
export const PHONE = { width: SCREEN.width + BORDER * 2, height: SCREEN.height + BORDER * 2 } as const;

/** The game's buttons in the frame's own pixels: x, y, width, height. */
export const BUTTONS = {
  strike: [13, 104, 306, 47],
  buyGatherer: [237, 176, 75, 39],
  buyCart: [237, 229, 75, 39],
  buyMill: [237, 282, 75, 39],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export type Tap = { at: number; button: keyof typeof BUTTONS };

function centre(button: keyof typeof BUTTONS): [number, number] {
  const [x, y, w, h] = BUTTONS[button];
  return [(x + w / 2) * K, (y - CROP + h / 2) * K];
}

export function Phone({ frame, taps = [], style }: { frame: number; taps?: readonly Tap[]; style?: CSSProperties }) {
  // The pointer glides to each button, arriving 8 frames before its tap.
  let px = SCREEN.width * 0.72;
  let py = SCREEN.height * 0.6;
  let pointer = 0;
  if (taps.length > 0) {
    pointer = progress(frame, taps[0]!.at - 24, 14);
    let from: [number, number] = [px, py];
    for (const tap of taps) {
      const to = centre(tap.button);
      const k = progress(frame, tap.at - 20, 12, EASE_IN_OUT);
      px = from[0] + (to[0] - from[0]) * k;
      py = from[1] + (to[1] - from[1]) * k;
      if (frame < tap.at - 8) break;
      from = to;
    }
  }
  return (
    <div
      style={{
        position: 'absolute',
        width: PHONE.width,
        height: PHONE.height,
        boxSizing: 'border-box',
        border: `${BORDER}px solid ${C.ink}`,
        borderRadius: 46,
        background: DUST_BACKGROUND,
        overflow: 'hidden',
        ...style,
      }}
    >
      <Img src={staticFile('dust-3600.png')} style={{ position: 'absolute', left: 0, top: -CROP * K, width: SCREEN.width, height: SCREEN.height }} />
      {taps.map((tap, i) => {
        const [x, y, w, h] = BUTTONS[tap.button];
        const press = tween(frame, tap.at, 3, 0, 1) - tween(frame, tap.at + 5, 8, 0, 1);
        const ring = progress(frame, tap.at, 22);
        const [cx, cy] = centre(tap.button);
        return (
          <div key={i}>
            <div style={{ position: 'absolute', left: x * K, top: (y - CROP) * K, width: w * K, height: h * K, borderRadius: 4, background: C.ink, opacity: press * 0.35 }} />
            {ring > 0 && ring < 1 ? (
              <div
                style={{
                  position: 'absolute',
                  left: cx - 44,
                  top: cy - 44,
                  width: 88,
                  height: 88,
                  borderRadius: '50%',
                  border: `3px solid ${C.paper}`,
                  transform: `scale(${0.2 + ring * 0.8})`,
                  opacity: 1 - ring,
                }}
              />
            ) : null}
          </div>
        );
      })}
      {pointer > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: px - 14,
            top: py - 14,
            width: 28,
            height: 28,
            boxSizing: 'border-box',
            borderRadius: '50%',
            background: C.paper,
            border: `3px solid ${C.ink}`,
            opacity: pointer,
            transform: `scale(${1 - 0.22 * taps.reduce((s, t) => s + (tween(frame, t.at - 2, 3, 0, 1) - tween(frame, t.at + 3, 8, 0, 1)), 0)})`,
          }}
        />
      ) : null}
    </div>
  );
}
