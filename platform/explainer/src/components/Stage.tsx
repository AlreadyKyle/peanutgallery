import type { ReactNode } from 'react';
import { STAGE, type Format } from '../format';

/** The 900 by 820 stage every scene is drawn on, placed and scaled for the cut. */
export function Stage({ format, children, shake = { x: 0, y: 0 } }: { format: Format; children: ReactNode; shake?: { x: number; y: number } }) {
  const { cx, cy, scale } = format.stage;
  return (
    <div
      style={{
        position: 'absolute',
        left: cx - (STAGE.width / 2) * scale,
        top: cy - (STAGE.height / 2) * scale,
        width: STAGE.width,
        height: STAGE.height,
        transform: `translate(${shake.x}px, ${shake.y}px) scale(${scale})`,
        transformOrigin: 'top left',
      }}
    >
      {children}
    </div>
  );
}

/** Places a child by its centre on the stage. */
export function At({ x, y, w, h, scale = 1, rotate = 0, opacity = 1, children }: { x: number; y: number; w: number; h: number; scale?: number; rotate?: number; opacity?: number; children: ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x - w / 2,
        top: y - h / 2,
        width: w,
        height: h,
        transform: `rotate(${rotate}deg) scale(${scale})`,
        opacity,
      }}
    >
      {children}
    </div>
  );
}
