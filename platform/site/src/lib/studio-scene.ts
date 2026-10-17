import type { StudioEra } from './community-types';
import { copy } from './copy';
import { onTheTeam, teamStatus } from './roster';
import type { Card, Role, Snapshot } from './source';

// The live studio's plan (docs/specs/final-state.md, The live studio): the room an era gives, its
// stations, and where each agent stands from the live data. Drafting is at the whiteboard, building
// at the desks, checks at the test bench, review at the gate, a ship at the dock; idle agents rest,
// read or chat in the lounge. Pure, so the room, the written list under it and the tests agree.

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
  const gate: Box = { x: w - 1.4, y: Math.round(d * 0.42 * 2) / 2, w: 0.3, d: 1.8, h: 2.2 };
  const dock: Box = { x: w - 2.6, y: d - 2.4, w: 2.6, d: 2.4, h: 0.25 };
  const sofa: Box = { x: 0.35, y: d - 1.5, w: 2.6, d: 0.95, h: 0.45 };
  const hopper: Box = { x: 1.3, y: 0.15, w: 0.9, d: 0.8, h: 1 };
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
    hopper,
    pipeX: 1.75,
    windows: size.windows.filter((x) => x < w - 1),
    decor: decor ?? size.decor,
    spots: {
      whiteboard: spread(1.1, 2.0, 3, 0.5, 0.7),
      desks: desks.flatMap((desk) => [{ x: desk.x + 0.9, y: desk.y + 1.45 }, { x: desk.x + 1.6, y: desk.y + 1.5 }]),
      bench: spread(bench.x + 0.7, 1.75, 3, 0.8),
      gate: spread(gate.x - 0.9, gate.y + 0.5, 2, 0, 0.9),
      dock: spread(dock.x + 0.8, dock.y + 1.1, 2, 0.9),
      lounge: [
        { x: 1.0, y: d - 2.3 },
        { x: 1.9, y: d - 2.55 },
        { x: 2.9, y: d - 2.2 },
        { x: 1.4, y: d - 3.4 },
        { x: 2.4, y: d - 3.5 },
        { x: 3.3, y: d - 3.2 },
      ],
    },
  };
}

export type AgentActivity = 'drafting' | 'building' | 'checks' | 'review' | 'shipping' | 'chatting' | 'reading' | 'resting' | 'paused';

export type AgentPlace = {
  role: Role;
  station: StationKey;
  spot: Spot;
  activity: AgentActivity;
  card: Pick<Card, 'id' | 'title'> | null;
  /** What it is doing, in one plain sentence from fixed words. */
  doing: string;
  asleep: boolean;
  /** Chatting partner, for the speech marks between two idle agents. */
  partner: string | null;
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
  for (const role of roomRoles(snapshot)) {
    const status = teamStatus(role, snapshot);
    if (status.kind === 'paused') {
      out.push({ role, station: 'lounge', spot: take('lounge'), activity: 'paused', card: null, doing: copy.studioRoom.doing.paused, asleep: true, partner: null });
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
        asleep: false,
        partner: null,
      });
      continue;
    }
    if (role.title === 'QA' && gated.length > 0) {
      const card = gated[0]!;
      out.push({ role, station: 'bench', spot: take('bench'), activity: 'checks', card, doing: say(copy.studioRoom.doing.checks, card), asleep: false, partner: null });
      continue;
    }
    if (/director/i.test(role.title) && working.length > 0) {
      const card = gated[0] ?? working[0]!;
      out.push({ role, station: 'gate', spot: take('gate'), activity: 'review', card, doing: say(copy.studioRoom.doing.review, card), asleep: false, partner: null });
      continue;
    }
    if (/designer/i.test(role.title) && snapshot.supply?.drafting === true) {
      out.push({ role, station: 'whiteboard', spot: take('whiteboard'), activity: 'drafting', card: null, doing: copy.studioRoom.doing.drafting, asleep: false, partner: null });
      continue;
    }
    const shipped = snapshot.cards.find(
      (card) => card.stage === 'live' && card.executor_role_id === role.id && card.live_at !== null && now - Date.parse(card.live_at) < SHIP_SHOWN_MS,
    );
    if (shipped !== undefined) {
      out.push({ role, station: 'dock', spot: take('dock'), activity: 'shipping', card: shipped, doing: say(copy.studioRoom.doing.shipping, shipped), asleep: false, partner: null });
      continue;
    }
    idle.push(role);
  }
  // Idle agents chat in pairs; one left over reads.
  idle.forEach((role, i) => {
    const pair = i % 2 === 0 ? idle[i + 1] : idle[i - 1];
    const chatting = pair !== undefined;
    out.push({
      role,
      station: 'lounge',
      spot: take('lounge'),
      activity: chatting ? 'chatting' : i === 0 ? 'resting' : 'reading',
      card: null,
      doing: chatting ? copy.studioRoom.doing.chatting.replace('{name}', pair!.name) : i === 0 ? copy.studioRoom.doing.resting : copy.studioRoom.doing.reading,
      asleep: false,
      partner: chatting ? pair!.id : null,
    });
  });
  return out;
}

/** Isometric projection of a floor point at height z, in SVG units of tile `t`. */
export function iso(x: number, y: number, z = 0, t = 32): { sx: number; sy: number } {
  return { sx: (x - y) * t, sy: ((x + y) * t) / 2 - z * t };
}
