import type { CSSProperties, ReactNode } from 'react';
import { avatarFeatures, avatarParts } from '../../../site/src/components/Avatar';
import { roomLayers, viewBoxOf } from '../../../site/src/components/RoomDrawing';
import { findPath, idleHaunts, iso, paintOrder, pathLength, roomPlan, seeded, type Box, type Spot } from '../../../site/src/lib/studio-scene';
import { roster } from '../data';
import { C, CREATURE } from '../theme';

// The live studio as the site draws it (StudioRoom.tsx): the era's room from the site's own drawing
// code, and the running agents in it, wandering between the room's idle spots round the furniture.
// The site walks them off the browser's clock; here the walk is worked out from the frame alone (a
// seeded route a role), so the same frame always draws the same room.

const ERA = 'garage' as const;
const AGENT_SCALE = 0.42;
/** Frames a tile of walking takes (the site's 520 ms at 60 fps), and an agent's rest between walks. */
const FRAMES_PER_TILE = 31;
const REST = [70, 170] as const;
const HORIZON = 60 * 120;

const plan = roomPlan(ERA);
const vb = viewBoxOf(plan);
const spots: Spot[] = idleHaunts(plan).flatMap((haunt) => haunt.spots);

type Leg = { from: Spot; path: Spot[]; len: number; start: number; dur: number; end: number };

/** Each agent's walks for the whole video, from its title alone. */
const routes: Leg[][] = roster.map((agent, i) => {
  const legs: Leg[] = [];
  let at = spots[(i * 3) % spots.length]!;
  let t = Math.round(seeded(agent.title, 0) * 90);
  for (let n = 1; t < HORIZON && n < 200; n++) {
    let next = spots[Math.floor(seeded(agent.title, n) * spots.length)]!;
    if (next.x === at.x && next.y === at.y) next = spots[(spots.indexOf(next) + 1) % spots.length]!;
    const path = findPath(plan, at, next);
    const len = pathLength(path);
    const dur = Math.max(20, Math.round(len * FRAMES_PER_TILE));
    const rest = REST[0] + Math.round(seeded(agent.title, n + 500) * (REST[1] - REST[0]));
    legs.push({ from: at, path, len, start: t, dur, end: t + dur });
    t += dur + rest;
    at = path[path.length - 1] ?? next;
  }
  return legs;
});

const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

function along(path: Spot[], len: number, k: number): { spot: Spot; dx: number } {
  let left = len * k;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= seg || i === path.length - 1) {
      const f = seg === 0 ? 1 : Math.min(1, left / seg);
      return { spot: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, dx: iso(b.x, b.y).sx - iso(a.x, a.y).sx };
    }
    left -= seg;
  }
  const last = path[path.length - 1]!;
  return { spot: last, dx: 0 };
}

/** Where agent `i` stands at frame `f`, which way it faces, and whether it is walking. */
export function agentAt(i: number, f: number): { spot: Spot; facing: 1 | -1; walking: boolean } {
  const legs = routes[i]!;
  let facing: 1 | -1 = i % 2 === 0 ? 1 : -1;
  let spot = legs[0]?.from ?? spots[0]!;
  for (const leg of legs) {
    if (f < leg.start) break;
    if (f < leg.end) {
      const { spot: s, dx } = along(leg.path, leg.len, ease((f - leg.start) / leg.dur));
      return { spot: s, facing: dx < 0 ? -1 : 1, walking: true };
    }
    spot = leg.path[leg.path.length - 1] ?? spot;
    const last = leg.path.length > 1 ? iso(leg.path[leg.path.length - 1]!.x, leg.path[leg.path.length - 1]!.y).sx - iso(leg.path[leg.path.length - 2]!.x, leg.path[leg.path.length - 2]!.y).sx : 0;
    if (last !== 0) facing = last < 0 ? -1 : 1;
  }
  return { spot, facing, walking: false };
}

const footAt = (spot: Spot): Box => ({ x: spot.x - 0.15, y: spot.y - 0.15, w: 0.3, d: 0.3, h: 1.5 });
const layers = roomLayers(plan, 11);

/** The room's projection of a floor spot into the picture's own pixels, for things drawn over it. */
export function project(spot: Spot, width: number, height: number): { x: number; y: number } {
  const s = Math.min(width / vb.w, height / vb.h);
  const ox = (width - vb.w * s) / 2;
  const oy = (height - vb.h * s) / 2;
  const p = iso(spot.x, spot.y);
  return { x: ox + (p.sx - vb.x) * s, y: oy + (p.sy - vb.y) * s };
}

export const CURATOR = roster.findIndex((r) => r.title === 'Curator');

/**
 * The room at `frame`, `width` by `height`. `show(i)` scales agent i in (0 to 1), for an agent that
 * joins; `hold` pins an agent where it stands from that frame on (the Curator, while it is pressed);
 * `ring` draws the site's selection ring round an agent's feet.
 */
export function IsoRoom({ frame, width, height, show, hold, ring }: { frame: number; width: number; height: number; show?: (i: number) => number; hold?: { agent: number; from: number }; ring?: { agent: number; k: number } }) {
  const items: { key: string; foot: Box; node: ReactNode }[] = layers.pieces.map((piece) => ({ key: `piece:${piece.key}`, foot: piece.foot, node: piece.node }));
  roster.forEach((agent, i) => {
    const f = hold !== undefined && hold.agent === i && frame > hold.from ? hold.from : frame;
    const { spot, facing, walking } = agentAt(i, f);
    const k = show === undefined ? 1 : show(i);
    if (k <= 0.001) return;
    const features = avatarFeatures(agent.note);
    const phase = ((frame + i * 13) % 30) / 30;
    const hop = walking ? Math.abs(Math.sin(phase * Math.PI)) * 4 : Math.abs(Math.sin(((frame + i * 17) % 60) / 60 * Math.PI)) * 1.6;
    const p = iso(spot.x, spot.y);
    const s = AGENT_SCALE;
    items.push({
      key: `agent:${agent.title}`,
      foot: footAt(spot),
      node: (
        <g transform={`translate(${p.sx} ${p.sy})`}>
          <ellipse cx={0} cy={0} rx={13 * k} ry={5 * k} fill={C.line} opacity={0.9} />
          {ring !== undefined && ring.agent === i && ring.k > 0 ? (
            <ellipse cx={0} cy={0} rx={24 + (1 - ring.k) * 10} ry={12 + (1 - ring.k) * 5} fill="none" stroke={C.ink} strokeWidth={3.2} opacity={Math.min(1, ring.k * 1.5)} />
          ) : null}
          <g transform={`translate(0 ${-hop}) scale(${facing * k} ${k})`}>
            <g style={{ '--avatar-fill': CREATURE[features.colour] } as CSSProperties} transform={`translate(${-60 * s} ${-113 * s}) scale(${s})`}>
              {avatarParts(features)}
            </g>
          </g>
        </g>
      ),
    });
  });
  const order = paintOrder(items.map((item) => item.foot));
  const vars = { '--ink': C.ink, '--paper': C.paper, '--paper-hover': C.paperHover, '--line': C.line, '--room-ink': 2.1 } as CSSProperties;
  return (
    <svg width={width} height={height} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block', overflow: 'visible', ...vars }}>
      <g className="room-drawing">{layers.back}</g>
      {order.map((i) => (
        <g key={items[i]!.key}>{items[i]!.node}</g>
      ))}
    </svg>
  );
}
