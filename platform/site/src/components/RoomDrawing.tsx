import type { ReactNode } from 'react';
import { iso, lampBox, paintOrder, type Box, type RoomPlan } from '../lib/studio-scene';

// The studio's room as a line drawing (docs/specs/final-state.md, The live studio and Studio
// evolution): an isometric room in the site's thick-line style, 2px ink strokes on paper fills, the
// stations and the era's decor. The live studio (StudioRoom.tsx) draws its agents over it; the
// history page draws it as a blueprint (data-variant="blueprint"), paper lines on the blueprint ground.

export const TILE = 32;

type P = readonly [number, number, number];

export function pts(points: readonly P[]): string {
  return points
    .map(([x, y, z]) => {
      const { sx, sy } = iso(x, y, z, TILE);
      return `${sx.toFixed(1)},${sy.toFixed(1)}`;
    })
    .join(' ');
}

function line(points: readonly P[], className = 'room-line'): ReactNode {
  return <polyline className={className} points={pts(points)} />;
}

/** A box: its top and the two faces that look at the viewer. */
export function box(b: Box, key: string, extra?: { top?: string; left?: string; right?: string }): ReactNode {
  const z = b.z ?? 0;
  const { x, y, w, d, h } = b;
  return (
    <g key={key}>
      <polygon className={extra?.right ?? 'room-side'} points={pts([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]])} />
      <polygon className={extra?.left ?? 'room-shade'} points={pts([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]])} />
      <polygon className={extra?.top ?? 'room-fill'} points={pts([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]])} />
    </g>
  );
}

export function viewBoxOf(plan: RoomPlan): { x: number; y: number; w: number; h: number } {
  const left = -plan.d * TILE - 24;
  const right = plan.w * TILE + 24;
  const top = -(plan.wall + 1) * TILE;
  const bottom = ((plan.w + plan.d) * TILE) / 2 + 28;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function Floor({ plan }: { plan: RoomPlan }) {
  const { w, d } = plan;
  const grid: ReactNode[] = [];
  for (let i = 1; i < w; i += 1) grid.push(<polyline key={`gx${i}`} className="room-grid" points={pts([[i, 0, 0], [i, d, 0]])} />);
  for (let j = 1; j < d; j += 1) grid.push(<polyline key={`gy${j}`} className="room-grid" points={pts([[0, j, 0], [w, j, 0]])} />);
  return (
    <g>
      <polygon className="room-fill" points={pts([[0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0]])} />
      {grid}
      <polygon className="room-edge" points={pts([[0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0]])} />
    </g>
  );
}

function Walls({ plan }: { plan: RoomPlan }) {
  const { w, d, wall } = plan;
  const t = 0.18;
  return (
    <g>
      {/* The left-hand wall (x = 0) and the right-hand wall (y = 0), each with a thick top edge. */}
      <polygon className="room-wall" points={pts([[0, 0, 0], [0, d, 0], [0, d, wall], [0, 0, wall]])} />
      <polygon className="room-wall-lit" points={pts([[0, 0, 0], [w, 0, 0], [w, 0, wall], [0, 0, wall]])} />
      <polygon className="room-fill room-cap" points={pts([[-t, -t, wall], [w, -t, wall], [w, 0, wall], [0, 0, wall], [0, d, wall], [-t, d, wall]])} />
      <polygon className="room-side room-cap" points={pts([[0, d, wall], [-t, d, wall], [-t, d, 0], [0, d, 0]])} />
      <polygon className="room-shade room-cap" points={pts([[w, 0, wall], [w, -t, wall], [w, -t, 0], [w, 0, 0]])} />
      {line([[0, 0, 0.18], [0, d, 0.18]], 'room-thin')}
      {line([[0, 0, 0.18], [w, 0, 0.18]], 'room-thin')}
      {line([[0, 0, 0], [0, 0, wall]])}
      {plan.windows.map((x) => (
        <g key={`win${x}`}>
          <polygon className="room-window" points={pts([[x, 0, 1.2], [x + 1.5, 0, 1.2], [x + 1.5, 0, 2.4], [x, 0, 2.4]])} />
          {line([[x + 0.75, 0, 1.2], [x + 0.75, 0, 2.4]], 'room-thin')}
          {line([[x, 0, 1.8], [x + 1.5, 0, 1.8]], 'room-thin')}
          {line([[x, 0.12, 1.2], [x + 1.5, 0.12, 1.2]], 'room-line')}
        </g>
      ))}
    </g>
  );
}

/** The pipe coins come down: on the right-hand wall, into a hopper on the floor. */
function Pipe({ plan }: { plan: RoomPlan }) {
  const x = plan.pipeX;
  const r = 0.2;
  const top = plan.wall + 0.7;
  const hop = plan.hopper;
  return (
    <g data-station="pipe">
      <polygon className="room-fill" points={pts([[x - r, 0.06, hop.h], [x + r, 0.06, hop.h], [x + r, 0.06, top], [x - r, 0.06, top]])} />
      {line([[x - r, 0.06, hop.h], [x - r, 0.06, top]])}
      {line([[x + r, 0.06, hop.h], [x + r, 0.06, top]])}
      {line([[x - r - 0.08, 0.06, top], [x + r + 0.08, 0.06, top]])}
      {[1.8, 2.6].map((z) => (
        <g key={z}>{line([[x - r - 0.06, 0.06, z], [x + r + 0.06, 0.06, z]], 'room-line')}</g>
      ))}
    </g>
  );
}

function Hopper({ plan }: { plan: RoomPlan }) {
  const hop = plan.hopper;
  return (
    <g data-station="hopper">
      {box(hop, 'hopper')}
      <polygon className="room-hole" points={pts([[hop.x + 0.2, hop.y + 0.15, hop.h], [hop.x + hop.w - 0.2, hop.y + 0.15, hop.h], [hop.x + hop.w - 0.2, hop.y + hop.d - 0.15, hop.h], [hop.x + 0.2, hop.y + hop.d - 0.15, hop.h]])} />
    </g>
  );
}

function Whiteboard({ plan }: { plan: RoomPlan }) {
  const b = plan.whiteboard;
  const z0 = b.z ?? 0.5;
  const x = 0.04;
  const y0 = b.y;
  const y1 = b.y + b.d;
  const notes: P[] = [
    [x, y0 + 0.3, z0 + 1.2],
    [x, y0 + 0.75, z0 + 1.25],
    [x, y0 + 1.7, z0 + 1.15],
  ];
  return (
    <g data-station="whiteboard">
      <polygon className="room-fill room-strong" points={pts([[x, y0, z0], [x, y1, z0], [x, y1, z0 + b.h * 0.75], [x, y0, z0 + b.h * 0.75]])} />
      {notes.map(([nx, ny, nz], i) => (
        <polygon key={i} className="room-shade" points={pts([[nx, ny, nz], [nx, ny + 0.32, nz], [nx, ny + 0.32, nz + 0.3], [nx, ny, nz + 0.3]])} />
      ))}
      {line([[x, y0 + 0.3, z0 + 0.7], [x, y0 + 1.1, z0 + 0.85], [x, y0 + 1.5, z0 + 0.55]], 'room-thin')}
      {line([[x, y0 + 1.25, z0 + 0.3], [x, y0 + 2.1, z0 + 0.3]], 'room-thin')}
      {line([[x, y0 + 0.2, z0], [x, y0 + 0.2, 0]])}
      {line([[x, y1 - 0.2, z0], [x, y1 - 0.2, 0]])}
      {line([[x + 0.12, y0, z0 - 0.02], [x + 0.12, y1, z0 - 0.02]], 'room-line')}
    </g>
  );
}

function Desk({ b, i }: { b: Box; i: number }) {
  const top = b.h;
  return (
    <g data-station="desk">
      {box({ x: b.x + 0.1, y: b.y + 0.1, w: 0.12, d: 0.12, h: top }, `leg-a${i}`)}
      {box({ x: b.x + b.w - 0.22, y: b.y + b.d - 0.22, w: 0.12, d: 0.12, h: top }, `leg-b${i}`)}
      {box({ x: b.x + 0.1, y: b.y + b.d - 0.22, w: 0.12, d: 0.12, h: top }, `leg-c${i}`)}
      {box({ ...b, z: top - 0.12, h: 0.12 }, `top${i}`)}
      {/* The monitor, its stand and a keyboard. */}
      {box({ x: b.x + 0.75, y: b.y + 0.2, w: 0.08, d: 0.08, z: top, h: 0.18 }, `stand${i}`)}
      {box({ x: b.x + 0.3, y: b.y + 0.15, w: 1.0, d: 0.1, z: top + 0.18, h: 0.6 }, `screen${i}`, { left: 'room-screen' })}
      <polygon className="room-shade" points={pts([[b.x + 0.4, b.y + 0.5, top], [b.x + 1.2, b.y + 0.5, top], [b.x + 1.2, b.y + 0.72, top], [b.x + 0.4, b.y + 0.72, top]])} />
      {box({ x: b.x + 1.45, y: b.y + 0.4, w: 0.18, d: 0.18, z: top, h: 0.2 }, `mug${i}`)}
    </g>
  );
}

function Bench({ plan }: { plan: RoomPlan }) {
  const b = plan.bench;
  return (
    <g data-station="bench">
      {box(b, 'bench')}
      {box({ x: b.x + 0.2, y: b.y + 0.1, w: 0.9, d: 0.1, z: b.h, h: 0.7 }, 'scope', { left: 'room-screen' })}
      {line([[b.x + 0.25, b.y + 0.2, b.h + 0.35], [b.x + 0.45, b.y + 0.2, b.h + 0.5], [b.x + 0.65, b.y + 0.2, b.h + 0.2], [b.x + 0.85, b.y + 0.2, b.h + 0.45], [b.x + 1.05, b.y + 0.2, b.h + 0.35]], 'room-thin')}
      {box({ x: b.x + 1.4, y: b.y + 0.3, w: 0.35, d: 0.35, z: b.h, h: 0.45 }, 'flask')}
      {box({ x: b.x + 1.95, y: b.y + 0.25, w: 0.45, d: 0.45, z: b.h, h: 0.2 }, 'probe')}
      {[0.35, 0.75, 1.15].map((dx) => {
        const { sx, sy } = iso(b.x + dx, b.y + b.d, b.h * 0.55, TILE);
        return <ellipse key={dx} className="room-fill room-strong" cx={sx} cy={sy} rx={5} ry={5} />;
      })}
    </g>
  );
}

/** The gate's marking on the floor: under everything that stands on it. */
function GateFloor({ plan }: { plan: RoomPlan }) {
  const g = plan.gate;
  return <polygon className="room-hatch" points={pts([[g.x - 0.4, g.y, 0], [g.x + 0.7, g.y, 0], [g.x + 0.7, g.y + g.d, 0], [g.x - 0.4, g.y + g.d, 0]])} />;
}

/** The gate's back post, and its front post with the lintel over both, so an agent can stand between. */
function GatePost({ plan, front }: { plan: RoomPlan; front: boolean }) {
  const g = plan.gate;
  if (!front) return <g data-station="gate">{box({ x: g.x, y: g.y, w: g.w, d: 0.3, h: g.h }, 'post-a')}</g>;
  return (
    <g data-station="gate">
      {box({ x: g.x, y: g.y + g.d - 0.3, w: g.w, d: 0.3, h: g.h }, 'post-b')}
      {box({ x: g.x - 0.05, y: g.y - 0.05, w: g.w + 0.1, d: g.d + 0.1, z: g.h, h: 0.3 }, 'lintel')}
      {/* A check mark on the lintel: the gate passes what it checks. */}
      {line([[g.x + g.w + 0.05, g.y + g.d * 0.4, g.h + 0.15], [g.x + g.w + 0.05, g.y + g.d * 0.48, g.h + 0.05], [g.x + g.w + 0.05, g.y + g.d * 0.62, g.h + 0.26]], 'room-line')}
    </g>
  );
}

function Dock({ plan }: { plan: RoomPlan }) {
  const k = plan.dock;
  return (
    <g data-station="dock">
      {box(k, 'dock')}
    </g>
  );
}

function Crates({ plan }: { plan: RoomPlan }) {
  const k = plan.dock;
  return (
    <g data-station="dock">
      {/* In the dock's front corner, clear of the gate and of the box a ship sends off. */}
      {box({ x: k.x + 1.65, y: k.y + k.d - 1.05, w: 0.8, d: 0.8, z: k.h, h: 0.7 }, 'crate-a')}
      {box({ x: k.x + 1.75, y: k.y + k.d - 0.95, w: 0.6, d: 0.6, z: k.h + 0.7, h: 0.5 }, 'crate-b')}
      {line([[k.x + 2.05, k.y + k.d - 0.95, k.h + 1.2], [k.x + 2.05, k.y + k.d - 0.35, k.h + 1.2]], 'room-thin')}
    </g>
  );
}

function Rug({ plan }: { plan: RoomPlan }) {
  const s = plan.sofa;
  // A plain rug with a woven border: dashes on this floor mean a zone, like the gate's.
  return (
    <g data-decor="rug">
      <polygon className="room-rug" points={pts([[0.9, s.y - 2.9, 0], [3.6, s.y - 2.9, 0], [3.6, s.y - 0.2, 0], [0.9, s.y - 0.2, 0]])} />
      <polygon className="room-rug-border" points={pts([[1.1, s.y - 2.7, 0], [3.4, s.y - 2.7, 0], [3.4, s.y - 0.4, 0], [1.1, s.y - 0.4, 0]])} />
    </g>
  );
}

function Sofa({ plan }: { plan: RoomPlan }) {
  const s = plan.sofa;
  return (
    <g data-station="lounge">
      {box(s, 'sofa-seat')}
      {box({ x: s.x, y: s.y + s.d - 0.28, w: s.w, d: 0.28, h: s.h + 0.55 }, 'sofa-back')}
      {box({ x: s.x - 0.05, y: s.y, w: 0.3, d: s.d, h: s.h + 0.2 }, 'sofa-arm-a')}
      {box({ x: s.x + s.w - 0.25, y: s.y, w: 0.3, d: s.d, h: s.h + 0.2 }, 'sofa-arm-b')}
    </g>
  );
}

function Table({ plan }: { plan: RoomPlan }) {
  const t = plan.table;
  return (
    <g data-station="lounge">
      {box(t, 'table')}
      {box({ x: t.x + 0.25, y: t.y + 0.1, w: 0.3, d: 0.22, z: t.h, h: 0.06 }, 'book')}
    </g>
  );
}

function Plant({ x, y }: { x: number; y: number }) {
  const { sx, sy } = iso(x + 0.25, y + 0.25, 0.75, TILE);
  return (
    <g data-decor="plant">
      {box({ x, y, w: 0.5, d: 0.5, h: 0.5 }, 'pot')}
      <path className="room-leaf" d={`M${sx} ${sy + 8} C ${sx - 16} ${sy - 4}, ${sx - 10} ${sy - 22}, ${sx} ${sy - 26} C ${sx + 12} ${sy - 20}, ${sx + 14} ${sy - 4}, ${sx} ${sy + 8} Z`} />
      <path className="room-thin" d={`M${sx} ${sy + 8} L ${sx} ${sy - 22}`} />
      <path className="room-leaf" d={`M${sx + 2} ${sy + 6} C ${sx + 20} ${sy + 2}, ${sx + 24} ${sy - 10}, ${sx + 18} ${sy - 14} C ${sx + 8} ${sy - 10}, ${sx + 2} ${sy - 2}, ${sx + 2} ${sy + 6} Z`} />
    </g>
  );
}

function Shelf({ plan, items, trophies }: { plan: RoomPlan; items: number; trophies: boolean }) {
  // On the left-hand wall near the front: a shelf, and on it the box art of each shipped game.
  const y0 = plan.d - 0.6 - 2.2;
  const z = 2.05;
  const out: ReactNode[] = [];
  out.push(<polygon key="board" className="room-fill room-strong" points={pts([[0, y0, z], [0, y0 + 2.2, z], [0.3, y0 + 2.2, z], [0.3, y0, z]])} />);
  const count = trophies ? Math.max(1, Math.min(items, 5)) : 3;
  for (let i = 0; i < count; i += 1) {
    const y = y0 + 0.15 + i * 0.42;
    out.push(
      <polygon key={`art${i}`} className={trophies ? 'room-fill room-strong' : 'room-shade'} points={pts([[0.06, y, z], [0.06, y + 0.3, z], [0.06, y + 0.3, z + 0.42], [0.06, y, z + 0.42]])} />,
    );
  }
  return <g data-decor={trophies ? 'trophy_shelf' : 'shelf'}>{out}</g>;
}

function LegendaryWall({ plan, count }: { plan: RoomPlan; count: number }) {
  // Framed box art, a frame for each legendary card shipped (up to three), left of the bench.
  const x0 = plan.bench.x - 3.1;
  return (
    <g data-decor="legendary_wall">
      {Array.from({ length: Math.max(1, Math.min(count, 3)) }, (_, i) => {
        const x = x0 + i * 1.0;
        return (
          <g key={i}>
            <polygon className="room-fill room-strong" points={pts([[x, 0.03, 1.5], [x + 0.8, 0.03, 1.5], [x + 0.8, 0.03, 2.5], [x, 0.03, 2.5]])} />
            <polygon className="room-shade" points={pts([[x + 0.12, 0.03, 1.62], [x + 0.68, 0.03, 1.62], [x + 0.68, 0.03, 2.38], [x + 0.12, 0.03, 2.38]])} />
            {line([[x + 0.2, 0.03, 1.8], [x + 0.4, 0.03, 2.1], [x + 0.6, 0.03, 1.9]], 'room-thin')}
          </g>
        );
      })}
    </g>
  );
}

function Lamp({ x, y }: { x: number; y: number }) {
  const base = iso(x, y, 0, TILE);
  const head = iso(x, y, 2, TILE);
  return (
    <g data-decor="lamp">
      <ellipse className="room-fill room-strong" cx={base.sx} cy={base.sy} rx={8} ry={4} />
      <path className="room-line" d={`M${base.sx} ${base.sy} L ${head.sx} ${head.sy}`} />
      <path className="room-fill room-strong" d={`M${head.sx - 10} ${head.sy + 8} L ${head.sx - 5} ${head.sy - 6} L ${head.sx + 5} ${head.sy - 6} L ${head.sx + 10} ${head.sy + 8} Z`} />
    </g>
  );
}

/** A piece of furniture that stands on the floor: drawn in painter's order with the agents. */
export type Piece = { key: string; foot: Box; node: ReactNode };

/** The room in two layers: what is under or on the walls (`back`), and what stands on the floor. */
export function roomLayers(plan: RoomPlan, shipped = 0, legendary = 0): { back: ReactNode; pieces: Piece[] } {
  const decor = plan.decor;
  const { gate, dock, sofa } = plan;
  const back = (
    <>
      <Floor plan={plan} />
      {decor.includes('rug') ? <Rug plan={plan} /> : null}
      <GateFloor plan={plan} />
      <Walls plan={plan} />
      {decor.includes('legendary_wall') ? <LegendaryWall plan={plan} count={legendary} /> : null}
      <Pipe plan={plan} />
      <Whiteboard plan={plan} />
      {decor.includes('shelf') || decor.includes('trophy_shelf') ? <Shelf plan={plan} items={shipped} trophies={decor.includes('trophy_shelf')} /> : null}
    </>
  );
  const pieces: Piece[] = [
    { key: 'hopper', foot: plan.hopper, node: <Hopper plan={plan} /> },
    { key: 'bench', foot: plan.bench, node: <Bench plan={plan} /> },
    ...plan.desks.map((desk, i) => ({ key: `desk${i}`, foot: desk, node: <Desk b={desk} i={i} /> })),
    { key: 'gate-a', foot: { x: gate.x, y: gate.y, w: gate.w, d: 0.3, h: gate.h }, node: <GatePost plan={plan} front={false} /> },
    { key: 'gate-b', foot: { x: gate.x, y: gate.y + gate.d - 0.3, w: gate.w, d: 0.3, h: gate.h }, node: <GatePost plan={plan} front /> },
    { key: 'sofa', foot: { x: sofa.x - 0.05, y: sofa.y, w: sofa.w + 0.1, d: sofa.d, h: sofa.h + 0.55 }, node: <Sofa plan={plan} /> },
    { key: 'table', foot: plan.table, node: <Table plan={plan} /> },
    { key: 'dock', foot: dock, node: <Dock plan={plan} /> },
    { key: 'crates', foot: { x: dock.x + 1.65, y: dock.y + dock.d - 1.05, w: 0.8, d: 0.8, h: 1.45 }, node: <Crates plan={plan} /> },
  ];
  if (decor.includes('plant')) pieces.push({ key: 'plant-a', foot: { x: plan.bench.x - 1.2, y: 0.2, w: 0.5, d: 0.5, h: 1 }, node: <Plant x={plan.bench.x - 1.2} y={0.2} /> });
  if (decor.includes('plant') && plan.w > 11) pieces.push({ key: 'plant-b', foot: { x: plan.w - 3.6, y: plan.d - 0.8, w: 0.5, d: 0.5, h: 1 }, node: <Plant x={plan.w - 3.6} y={plan.d - 0.8} /> });
  if (decor.includes('lamp')) pieces.push({ key: 'lamp', foot: lampBox(plan), node: <Lamp x={lampBox(plan).x + 0.1} y={lampBox(plan).y + 0.1} /> });
  return { back, pieces };
}

/** The whole room, back to front, with nobody in it (the blueprint on /studio/history). */
export function RoomDrawing({ plan, shipped = 0, legendary = 0 }: { plan: RoomPlan; shipped?: number; legendary?: number }) {
  const { back, pieces } = roomLayers(plan, shipped, legendary);
  return (
    <g className="room-drawing">
      {back}
      {paintOrder(pieces.map((piece) => piece.foot)).map((i) => (
        <g key={pieces[i]!.key}>{pieces[i]!.node}</g>
      ))}
    </g>
  );
}
