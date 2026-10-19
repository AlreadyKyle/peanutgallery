import type { StudioEra } from './community-types';
import { copy } from './copy';
import { onTheTeam, teamStatus } from './roster';
import { agentsOffline } from './offline';
import type { Card, Role, Snapshot } from './source';

// The live studio's plan (docs/specs/final-state.md, The live studio): the room an era gives, its
// stations, and where each agent stands from the live data. Drafting is at the whiteboard, building
// at the desks, checks at the test bench, review at the gate, a ship at the dock; idle agents rest,
// read or chat in the lounge, and between cards wander the room (idleHaunts). Pure, so the room, the
// written list under it and the tests agree.

export type EraKey = 'garage' | 'workshop' | 'studio' | 'campus';
export const ERA_KEYS: readonly EraKey[] = ['garage', 'workshop', 'studio', 'campus'];

export type StationKey = 'whiteboard' | 'desks' | 'bench' | 'gate' | 'dock' | 'lounge';

/** A point on the floor, in tiles: x runs to the right-hand back wall, y to the left-hand one. */
export type Spot = { x: number; y: number };
export type Box = { x: number; y: number; z?: number; w: number; d: number; h: number };

export type RoomPlan = {
  era: EraKey;
  w: number;
  d: number;
  wall: number;
  desks: Box[];
  whiteboard: Box;
  bench: Box;
  gate: Box;
  dock: Box;
  sofa: Box;
  table: Box;
  hopper: Box;
  pipeX: number;
  windows: number[];
  decor: readonly string[];
  spots: Record<StationKey, Spot[]>;
};

const SIZES: Record<EraKey, { w: number; d: number; desks: number; windows: number[]; decor: string[] }> = {
  garage: { w: 9, d: 7, desks: 2, windows: [5], decor: ['shelf', 'lamp'] },
  workshop: { w: 11, d: 8, desks: 3, windows: [5, 7.5], decor: ['shelf', 'plant', 'lamp'] },
  studio: { w: 13, d: 9, desks: 4, windows: [5, 7.5, 10], decor: ['plant', 'trophy_shelf', 'lamp', 'rug'] },
  campus: { w: 15, d: 10, desks: 6, windows: [5, 7.5, 10, 12.5], decor: ['plant', 'trophy_shelf', 'legendary_wall', 'rug', 'lamp'] },
};

/** An era's key from the studio document: by its name, else by its place, else the garage. */
export function eraKey(era: Pick<StudioEra, 'name' | 'index'> | null | undefined): EraKey {
  if (era === null || era === undefined) return 'garage';
  const named = ERA_KEYS.find((key) => key === era.name.trim().toLowerCase());
  if (named !== undefined) return named;
  return ERA_KEYS[Math.max(0, Math.min(ERA_KEYS.length - 1, era.index))]!;
}

// Around the coffee table: two pairs that face each other across its ends, one between it and the
// sofa's seat and one behind it; never on it.
const loungePairs = (table: Box, sofa: Box): [Spot, Spot][] => [
  [{ x: table.x - 0.3, y: sofa.y - 0.35 }, { x: table.x + 1.2, y: sofa.y - 0.35 }],
  [{ x: table.x - 0.3, y: table.y - 0.45 }, { x: table.x + 1.2, y: table.y - 0.45 }],
];
export function roomPlan(era: EraKey, decor?: readonly string[]): RoomPlan {
  const size = SIZES[era];
  const { w, d } = size;
  const cols = Math.ceil(size.desks / 2);
  const desks: Box[] = Array.from({ length: size.desks }, (_, i) => ({
    x: 3.6 + (i % cols) * 2.5,
    y: 2.4 + Math.floor(i / cols) * 2.5,
    w: 1.8,
    d: 0.9,
    h: 0.7,
  }));
  const whiteboard: Box = { x: 0, y: 1.4, w: 0.15, d: 2.4, h: 1.9, z: 0.5 };
  const bench: Box = { x: w - 4.4, y: 0.15, w: 2.6, d: 0.9, h: 0.8 };
  const dock: Box = { x: w - 2.6, y: d - 2.4, w: 2.6, d: 2.4, h: 0.25 };
  // The gate stands clear of the dock (in the garage its second post would stand in the dock's edge),
  // and near the right-hand wall, its lintel clear of the desks and the bench behind it and just over
  // the reviewer's mark.
  const gate: Box = { x: w - 1.1, y: Math.min(Math.round(d * 0.42 * 2) / 2, dock.y - 2.2), w: 0.3, d: 1.8, h: 1.9 };
  const sofa: Box = { x: 0.35, y: d - 1.5, w: 2.6, d: 0.95, h: 0.45 };
  const table: Box = { x: sofa.x + 0.9, y: sofa.y - 1.4, w: 0.9, d: 0.6, h: 0.35 };
  const hopper: Box = { x: 1.3, y: 0.15, w: 0.9, d: 0.8, h: 1 };
  // A window never sits behind the legendary wall's frames, which hang left of the bench (RoomDrawing).
  const legendary = (decor ?? size.decor).includes('legendary_wall');
  const spread = (x: number, y: number, n: number, dx: number, dy = 0): Spot[] => Array.from({ length: n }, (_, i) => ({ x: x + i * dx, y: y + i * dy }));
  return {
    era,
    w,
    d,
    wall: 3,
    desks,
    whiteboard,
    bench,
    gate,
    dock,
    sofa,
    table,
    hopper,
    pipeX: 1.75,
    windows: size.windows.filter((x) => x < w - 1 && !(legendary && x + 1.5 > bench.x - 3.2 && x < bench.x - 0.2)),
    decor: decor ?? size.decor,
    spots: {
      whiteboard: spread(1.1, 2.0, 3, 0.5, 0.7),
      // One builder at each desk's keyboard first; a second at a desk only once every desk has one.
      desks: [...desks.map((desk) => ({ x: desk.x + 0.9, y: desk.y + 1.45 })), ...desks.map((desk) => ({ x: desk.x + 1.6, y: desk.y + 1.5 }))],
      bench: spread(bench.x + 0.7, 1.75, 3, 0.8),
      // The reviewer stands in the gate, between its posts; a second one beside its front post, a body clear of the first.
      gate: [
        { x: gate.x + 0.15, y: gate.y + gate.d / 2 },
        { x: gate.x - 0.6, y: gate.y + gate.d + 0.45 },
      ],
      dock: spread(dock.x + 0.8, dock.y + 1.1, 2, 0.9),
      lounge: loungePairs(table, sofa).flat(),
    },
  };
}

// Every activity is awake (the board, 19 October 2026): an agent with no work, the agents offline or a role
// the board paused, putters about the room like any idle agent; only work changes what it does.
export type AgentActivity = 'drafting' | 'building' | 'checks' | 'review' | 'shipping' | 'chatting' | 'reading' | 'resting';

export type AgentPlace = {
  role: Role;
  station: StationKey;
  spot: Spot;
  activity: AgentActivity;
  card: Pick<Card, 'id' | 'title'> | null;
  /** What it is doing, in one plain sentence from fixed words. */
  doing: string;
  /** Chatting partner, for the speech marks between two idle agents. */
  partner: string | null;
  /** Where an agent with no card is in the room (idleHaunts); null at a station. */
  haunt: HauntKey | null;
};

const SHIP_SHOWN_MS = 6 * 60 * 60 * 1000;

/** The roles in the room: the team's running and paused roles, in roster order. */
export function roomRoles(snapshot: Snapshot): Role[] {
  return snapshot.roles.filter((role) => role.state === 'active' && onTheTeam(teamStatus(role, snapshot)));
}

export function placeAgents(snapshot: Snapshot, plan: RoomPlan, now: number = Date.now()): AgentPlace[] {
  const used: Record<StationKey, number> = { whiteboard: 0, desks: 0, bench: 0, gate: 0, dock: 0, lounge: 0 };
  const take = (station: StationKey): Spot => {
    const spots = plan.spots[station];
    const i = used[station];
    used[station] += 1;
    const base = spots[i % spots.length]!;
    // Past the station's spots, stand a little further out rather than on top of another agent.
    const round = Math.floor(i / spots.length);
    return round === 0 ? base : { x: base.x + 0.45 * round, y: base.y + 0.45 * round };
  };
  const working = snapshot.cards.filter((card) => card.stage === 'building' || card.stage === 'gated');
  const gated = snapshot.cards.filter((card) => card.stage === 'gated');
  const out: AgentPlace[] = [];
  const idle: Role[] = [];
  const say = (text: string, card: Pick<Card, 'title'> | null) => (card === null ? text : text.replace('{title}', card.title));
  // While the agents are offline nobody works: every agent putters about the room as an idle one does,
  // and says the agents are offline (docs/specs/honest-status.md). A role the board paused putters too.
  const offline = agentsOffline(snapshot);
  const says = new Map<string, string>();
  for (const role of roomRoles(snapshot)) {
    if (offline) {
      says.set(role.id, copy.agentsOffline);
      idle.push(role);
      continue;
    }
    if (teamStatus(role, snapshot).kind === 'paused') {
      says.set(role.id, copy.studioRoom.doing.paused);
      idle.push(role);
      continue;
    }
    const own = working.find((card) => card.executor_role_id === role.id);
    if (own !== undefined) {
      const building = own.stage === 'building';
      out.push({
        role,
        station: building ? 'desks' : 'bench',
        spot: take(building ? 'desks' : 'bench'),
        activity: building ? 'building' : 'checks',
        card: own,
        doing: say(building ? copy.studioRoom.doing.building : copy.studioRoom.doing.checks, own),
        partner: null,
        haunt: null,
      });
      continue;
    }
    if (role.title === 'QA' && gated.length > 0) {
      const card = gated[0]!;
      out.push({ role, station: 'bench', spot: take('bench'), activity: 'checks', card, doing: say(copy.studioRoom.doing.checks, card), partner: null, haunt: null });
      continue;
    }
    if (/director/i.test(role.title) && working.length > 0) {
      const card = gated[0] ?? working[0]!;
      out.push({ role, station: 'gate', spot: take('gate'), activity: 'review', card, doing: say(copy.studioRoom.doing.review, card), partner: null, haunt: null });
      continue;
    }
    if (/designer/i.test(role.title) && snapshot.supply?.drafting === true) {
      out.push({ role, station: 'whiteboard', spot: take('whiteboard'), activity: 'drafting', card: null, doing: copy.studioRoom.doing.drafting, partner: null, haunt: null });
      continue;
    }
    const shipped = snapshot.cards.find(
      (card) => card.stage === 'live' && card.executor_role_id === role.id && card.live_at !== null && now - Date.parse(card.live_at) < SHIP_SHOWN_MS,
    );
    if (shipped !== undefined) {
      out.push({ role, station: 'dock', spot: take('dock'), activity: 'shipping', card: shipped, doing: say(copy.studioRoom.doing.shipping, shipped), partner: null, haunt: null });
      continue;
    }
    idle.push(role);
  }
  // Idle agents chat in pairs, one left over reads, and they start spread over the room: each pair at
  // its own haunt (the lounge, the whiteboard, the dock, the hopper, then the lounge's second pair), a
  // lone one in the lounge or at a quiet spot, nobody standing over anybody.
  const haunts = idleHaunts(plan);
  const taken: Spot[] = out.map((place) => place.spot);
  const clear = (spot: Spot) => taken.every((other) => !crowded(other, spot));
  const deepest = Math.max(0, ...haunts.map((haunt) => haunt.pairs.length));
  const seats: { haunt: HauntKey; pair: [Spot, Spot] }[] = [];
  for (let i = 0; i < deepest; i += 1) for (const haunt of haunts) if (haunt.pairs[i] !== undefined) seats.push({ haunt: haunt.key, pair: haunt.pairs[i]! });
  const lone = haunts.flatMap((haunt) => haunt.spots.map((spot) => ({ haunt: haunt.key, spot })));
  const kept = new Map<string, { haunt: HauntKey; spot: Spot }>();
  const alone = () => {
    const free = lone.find((one) => clear(one.spot));
    if (free !== undefined) taken.push(free.spot);
    return free ?? null;
  };
  idle.forEach((role, i) => {
    const pair = i % 2 === 0 ? idle[i + 1] : idle[i - 1];
    const chatting = pair !== undefined;
    let at: { haunt: HauntKey; spot: Spot } | null;
    if (chatting && i % 2 === 0) {
      const seat = seats.find((one) => clear(one.pair[0]) && clear(one.pair[1]));
      if (seat !== undefined) {
        taken.push(seat.pair[0], seat.pair[1]);
        at = { haunt: seat.haunt, spot: seat.pair[0] };
        kept.set(pair!.id, { haunt: seat.haunt, spot: seat.pair[1] });
      } else {
        // No pair of spots left: each stands alone until their stroll brings them together.
        at = alone();
      }
    } else {
      // The second of a pair stands at the spot its partner kept for it.
      at = (chatting ? kept.get(role.id) : undefined) ?? alone();
    }
    const spot = at?.spot ?? null;
    const haunt = at?.haunt ?? 'lounge';
    out.push({
      role,
      station: 'lounge',
      spot: spot ?? take('lounge'),
      activity: chatting ? 'chatting' : i === 0 ? 'resting' : 'reading',
      card: null,
      doing: says.get(role.id) ?? (chatting ? copy.studioRoom.doing.chatting.replace('{name}', pair!.name) : i === 0 ? copy.studioRoom.doing.resting : copy.studioRoom.doing.reading),
      partner: chatting ? pair!.id : null,
      haunt: spot === null ? 'lounge' : haunt,
    });
  });
  return out;
}

/** Isometric projection of a floor point at height z, in SVG units of tile `t`. */
export function iso(x: number, y: number, z = 0, t = 32): { sx: number; sy: number } {
  return { sx: (x - y) * t, sy: ((x + y) * t) / 2 - z * t };
}

// Walking and idling (DESIGN.md, The live studio): agents walk around the furniture, not through it,
// and an agent with no card wanders between the room's idle spots instead of standing still.

/** The floor lamp's footprint: against the left-hand wall, a step back from the sofa's end. */
export function lampBox(plan: RoomPlan): Box {
  return { x: 0.35, y: plan.sofa.y - 1.45, w: 0.2, d: 0.2, h: 2 };
}

/** What stands on the floor, as footprints: what an agent walks around and what it can stand behind. */
export function floorBoxes(plan: RoomPlan): Box[] {
  const { sofa, gate, dock } = plan;
  const out: Box[] = [
    ...plan.desks,
    plan.bench,
    plan.hopper,
    plan.table,
    { x: sofa.x - 0.05, y: sofa.y, w: sofa.w + 0.1, d: sofa.d, h: sofa.h + 0.55 },
    { x: gate.x, y: gate.y, w: gate.w, d: 0.3, h: gate.h },
    { x: gate.x, y: gate.y + gate.d - 0.3, w: gate.w, d: 0.3, h: gate.h },
    { x: dock.x + 1.65, y: dock.y + dock.d - 1.05, w: 0.8, d: 0.8, h: 1.2 },
  ];
  if (plan.decor.includes('plant')) {
    out.push({ x: plan.bench.x - 1.2, y: 0.2, w: 0.5, d: 0.5, h: 1 });
    if (plan.w > 11) out.push({ x: plan.w - 3.6, y: plan.d - 0.8, w: 0.5, d: 0.5, h: 1 });
  }
  if (plan.decor.includes('lamp')) out.push(lampBox(plan));
  return out;
}

const CELL = 0.25;
const CLEAR = 0.3;

type Grid = { cols: number; rows: number; blocked: Uint8Array };

const grids = new WeakMap<RoomPlan, Grid>();

function gridOf(plan: RoomPlan): Grid {
  const known = grids.get(plan);
  if (known !== undefined) return known;
  const cols = Math.round(plan.w / CELL);
  const rows = Math.round(plan.d / CELL);
  const blocked = new Uint8Array(cols * rows);
  const boxes = floorBoxes(plan);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = (c + 0.5) * CELL;
      const y = (r + 0.5) * CELL;
      // 2: inside a piece, never walked through; 1: its margin or the wall's, walked only when needed.
      const inside = boxes.some((b) => x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.d);
      const wall = x < CLEAR + 0.1 || y < CLEAR + 0.1 || x > plan.w - CLEAR || y > plan.d - CLEAR;
      const near = boxes.some((b) => x > b.x - CLEAR && x < b.x + b.w + CLEAR && y > b.y - CLEAR && y < b.y + b.d + CLEAR);
      blocked[r * cols + c] = inside ? 2 : wall || near ? 1 : 0;
    }
  }
  const grid = { cols, rows, blocked };
  grids.set(plan, grid);
  return grid;
}

function cellOf(grid: Grid, spot: Spot): number {
  const c = Math.max(0, Math.min(grid.cols - 1, Math.floor(spot.x / CELL)));
  const r = Math.max(0, Math.min(grid.rows - 1, Math.floor(spot.y / CELL)));
  return r * grid.cols + c;
}

/** True when an agent can stand on the spot without standing in a piece of furniture. */
export function standable(plan: RoomPlan, spot: Spot): boolean {
  const grid = gridOf(plan);
  return grid.blocked[cellOf(grid, spot)] === 0;
}

/**
 * The way from one spot to another round the furniture: the corners of the shortest walk on a quarter
 * tile grid, straight runs preferred over zigzags and open floor over a piece's margin, from `from`
 * to `to` inclusive. It never crosses a piece; when no way is found the walk is straight.
 */
export function findPath(plan: RoomPlan, from: Spot, to: Spot): Spot[] {
  const grid = gridOf(plan);
  const { cols, rows, blocked } = grid;
  const start = cellOf(grid, from);
  const goal = cellOf(grid, to);
  if (start === goal) return [from, to];
  const size = cols * rows;
  // State: cell and the direction it was entered by (0 none, 1 x, 2 y), so a turn can cost extra.
  const cost = new Float64Array(size * 3).fill(Infinity);
  const prev = new Int32Array(size * 3).fill(-1);
  const open: [number, number][] = [];
  const h = (cell: number) => Math.abs((cell % cols) - (goal % cols)) + Math.abs(Math.floor(cell / cols) - Math.floor(goal / cols));
  const score = new Float64Array(size * 3).fill(Infinity);
  cost[start * 3] = 0;
  score[start * 3] = h(start);
  open.push([score[start * 3]!, start * 3]);
  let found = -1;
  // A binary heap of [score, state].
  const push = (entry: [number, number]) => {
    open.push(entry);
    let i = open.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (open[up]![0] <= open[i]![0]) break;
      [open[up], open[i]] = [open[i]!, open[up]!];
      i = up;
    }
  };
  const pop = (): number => {
    const top = open[0]!;
    const last = open.pop()!;
    if (open.length > 0) {
      open[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < open.length && open[l]![0] < open[m]![0]) m = l;
        if (r < open.length && open[r]![0] < open[m]![0]) m = r;
        if (m === i) break;
        [open[m], open[i]] = [open[i]!, open[m]!];
        i = m;
      }
    }
    return top[1];
  };
  const closed = new Uint8Array(size * 3);
  while (open.length > 0) {
    const state = pop();
    if (closed[state] === 1) continue;
    closed[state] = 1;
    const cell = Math.floor(state / 3);
    const dir = state % 3;
    if (cell === goal) {
      found = state;
      break;
    }
    const c = cell % cols;
    const r = Math.floor(cell / cols);
    const steps: [number, number, number][] = [
      [c + 1, r, 1],
      [c - 1, r, 1],
      [c, r + 1, 2],
      [c, r - 1, 2],
    ];
    for (const [nc, nr, nd] of steps) {
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const next = nr * cols + nc;
      if (blocked[next] === 2 && next !== goal) continue;
      const turn = dir !== 0 && dir !== nd ? 2.5 : 0;
      const g = cost[state]! + 1 + turn + (blocked[next] === 1 && next !== goal ? 6 : 0);
      const key = next * 3 + nd;
      if (g < cost[key]!) {
        cost[key] = g;
        prev[key] = state;
        score[key] = g + h(next);
        push([score[key]!, key]);
      }
    }
  }
  if (found < 0) return [from, to];
  const cells: number[] = [];
  for (let state = found; state >= 0; state = prev[state]!) cells.push(Math.floor(state / 3));
  cells.reverse();
  // The corners only: where the walk turns. The first run is moved onto the start's line and the last
  // onto the end's, so the agent walks straight off its spot and straight on to the next.
  const centre = (cell: number): Spot => ({ x: ((cell % cols) + 0.5) * CELL, y: (Math.floor(cell / cols) + 0.5) * CELL });
  const corners: Spot[] = [];
  for (let i = 1; i < cells.length - 1; i += 1) {
    if (cells[i]! - cells[i - 1]! !== cells[i + 1]! - cells[i]!) corners.push(centre(cells[i]!));
  }
  const firstAcross = Math.abs(cells[1]! - cells[0]!) === 1;
  const lastAcross = Math.abs(cells[cells.length - 1]! - cells[cells.length - 2]!) === 1;
  if (corners.length === 0) {
    const elbow = firstAcross ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
    return elbow.x === to.x && elbow.y === to.y ? [from, to] : [from, elbow, to];
  }
  const first = corners[0]!;
  corners[0] = firstAcross ? { x: first.x, y: from.y } : { x: from.x, y: first.y };
  const last = corners[corners.length - 1]!;
  if (corners.length === 1) {
    corners[0] = firstAcross ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  } else {
    corners[corners.length - 1] = lastAcross ? { x: last.x, y: to.y } : { x: to.x, y: last.y };
  }
  return [from, ...corners, to];
}

/** A walk's length in tiles. */
export function pathLength(path: readonly Spot[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) total += Math.abs(path[i]!.x - path[i - 1]!.x) + Math.abs(path[i]!.y - path[i - 1]!.y);
  return total;
}

export type HauntKey = 'lounge' | 'whiteboard' | 'hopper' | 'bench' | 'plant' | 'window' | 'dock';

/**
 * A place an idle agent goes: the spots one agent can take there, and the pairs of spots a chatting
 * pair stands at, a body apart and side by side as the room is seen, never one on top of the other.
 */
export type Haunt = { key: HauntKey; spots: Spot[]; pairs: [Spot, Spot][] };

/** True when two agents at these spots would overlap as the room is drawn. */
export function crowded(a: Spot, b: Spot): boolean {
  return Math.abs(a.x - a.y - (b.x - b.y)) < 1.2 && Math.abs((a.x + a.y - b.x - b.y) / 2) < 0.9;
}

/** Where an agent with no card wanders: the lounge, the whiteboard, the hopper, the dock, the bench, a window, the plant. */
export function idleHaunts(plan: RoomPlan): Haunt[] {
  const { hopper, bench, dock, whiteboard } = plan;
  const raw: { key: HauntKey; pairs: [Spot, Spot][]; solo: Spot[] }[] = [
    { key: 'lounge', pairs: loungePairs(plan.table, plan.sofa), solo: [] },
    { key: 'whiteboard', pairs: [[{ x: 1.15, y: whiteboard.y + 0.5 }, { x: 1.15, y: whiteboard.y + 1.9 }]], solo: [] },
    // On the dock, clear of the crates in its front corner.
    { key: 'dock', pairs: [[{ x: dock.x + 0.3, y: dock.y + 0.5 }, { x: dock.x + 0.3, y: dock.y + 1.8 }]], solo: [] },
    { key: 'hopper', pairs: [[{ x: hopper.x + 0.7, y: hopper.y + hopper.d + 0.55 }, { x: hopper.x + 2.1, y: hopper.y + hopper.d + 0.55 }]], solo: [] },
    { key: 'bench', pairs: [], solo: [{ x: bench.x + 1.9, y: bench.y + bench.d + 0.7 }] },
  ];
  if (plan.decor.includes('plant')) raw.push({ key: 'plant', pairs: [], solo: [{ x: bench.x - 0.95, y: 1.15 }] });
  // A window over open floor, not over the bench.
  const window = plan.windows.find((x) => x + 1.5 < bench.x - 0.2 || x > bench.x + bench.w + 0.2);
  if (window !== undefined) raw.push({ key: 'window', pairs: [], solo: [{ x: window + 0.75, y: 0.75 }] });
  const ok = (spot: Spot) => standable(plan, spot);
  return raw
    .map(({ key, pairs, solo }) => {
      const kept = pairs.filter(([a, b]) => ok(a) && ok(b));
      return { key, pairs: kept, spots: [...kept.flat(), ...solo.filter(ok)] };
    })
    .filter((haunt) => haunt.spots.length > 0);
}

/** A small, repeatable random number from a seed, so each agent's wandering has its own rhythm. */
export function seeded(seed: string, n: number): number {
  let h = 2166136261;
  const text = `${seed}:${n}`;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Painter's order for the room's furniture and agents: `behind(a, b)` is true when a must be drawn
 * before b. Footprints that do not overlap are ordered by the axis that separates them; an agent on a
 * low piece (the dock) stands on it.
 */
export function behind(a: Box, b: Box): boolean {
  if (a.x + a.w <= b.x + 1e-6 || a.y + a.d <= b.y + 1e-6) return true;
  if (b.x + b.w <= a.x + 1e-6 || b.y + b.d <= a.y + 1e-6) return false;
  if (a.h <= 0.3 && b.h > a.h) return true;
  if (b.h <= 0.3 && a.h > b.h) return false;
  return a.x + a.w / 2 + a.y + a.d / 2 < b.x + b.w / 2 + b.y + b.d / 2;
}

/** The order to draw footprints in: each after everything it stands in front of. */
export function paintOrder(boxes: readonly Box[]): number[] {
  const n = boxes.length;
  const after: number[][] = Array.from({ length: n }, () => []);
  const waiting = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (i !== j && behind(boxes[i]!, boxes[j]!) && !behind(boxes[j]!, boxes[i]!)) {
        after[i]!.push(j);
        waiting[j]! += 1;
      }
    }
  }
  const depth = (i: number) => boxes[i]!.x + boxes[i]!.w / 2 + boxes[i]!.y + boxes[i]!.d / 2;
  const done = new Array<boolean>(n).fill(false);
  const out: number[] = [];
  while (out.length < n) {
    // The ready one furthest back; a cycle (it cannot happen with the room's footprints) breaks by depth.
    let pick = -1;
    for (let i = 0; i < n; i += 1) if (!done[i] && waiting[i] === 0 && (pick < 0 || depth(i) < depth(pick))) pick = i;
    if (pick < 0) for (let i = 0; i < n; i += 1) if (!done[i] && (pick < 0 || depth(i) < depth(pick))) pick = i;
    done[pick] = true;
    out.push(pick);
    for (const j of after[pick]!) waiting[j]! -= 1;
  }
  return out;
}
