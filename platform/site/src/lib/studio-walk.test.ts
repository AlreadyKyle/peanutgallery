import { describe, expect, it } from 'vitest';
import type { Role, Snapshot } from './source';
import { crowded, ERA_KEYS, findPath, floorBoxes, idleHaunts, paintOrder, pathLength, placeAgents, roomPlan, standable, type Box, type Spot } from './studio-scene';

// The live studio's walking (DESIGN.md, The live studio): agents go round the furniture, the idle
// spots are on open floor, and the painter's order puts what is in front over what is behind.

function idleRoom(count: number): Snapshot {
  const roles: Role[] = Array.from({ length: count }, (_, i) => ({
    id: `agent-${i}`,
    name: `Agent ${i}`,
    title: `Helper ${i}`,
    description: null,
    species_note: 'A small blue creature.',
    model: 'claude-opus-5-5',
    write_access: false,
    state: 'active',
    hired_at: '2026-09-14T00:00:00Z',
    status: 'running',
    trigger: null,
    paused: false,
    paused_reason: null,
  }));
  return {
    pool: null,
    cards: [],
    funding: {},
    launchedAt: null,
    paused: false,
    totals: { usd_total: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, row_count: 0 },
    events: [],
    deploys: [],
    roles,
    cardTitles: {},
    missing: [],
  };
}

const inside = (b: Box, p: Spot) => p.x > b.x + 0.01 && p.x < b.x + b.w - 0.01 && p.y > b.y + 0.01 && p.y < b.y + b.d - 0.01;

/** Every point along a walk, a twentieth of a tile apart. */
function along(path: readonly Spot[]): Spot[] {
  const out: Spot[] = [];
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const n = Math.max(1, Math.ceil((Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) * 20));
    for (let k = 0; k <= n; k += 1) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

describe('the studio floor', () => {
  for (const era of ERA_KEYS) {
    const plan = roomPlan(era);
    const boxes = floorBoxes(plan);
    const stations = Object.values(plan.spots).flat();
    const haunts = idleHaunts(plan).flatMap((haunt) => haunt.spots);

    it(`puts no station or idle spot inside a piece of furniture in the ${era}`, () => {
      for (const spot of [...stations, ...haunts]) for (const b of boxes) expect(inside(b, spot), `${JSON.stringify(spot)} in ${JSON.stringify(b)}`).toBe(false);
      for (const spot of haunts) expect(standable(plan, spot)).toBe(true);
      expect(idleHaunts(plan).length).toBeGreaterThanOrEqual(4);
    });

    it(`stands a chatting pair a body apart, and spreads a room of idle agents out, in the ${era}`, () => {
      for (const haunt of idleHaunts(plan)) for (const [a, b] of haunt.pairs) expect(crowded(a, b), `${haunt.key} ${JSON.stringify([a, b])}`).toBe(false);
      for (const count of [2, 5, 8]) {
        const places = placeAgents(idleRoom(count), plan);
        expect(places.filter((place) => place.activity === 'chatting')).toHaveLength(count - (count % 2));
        for (let i = 0; i < places.length; i += 1) {
          for (let j = i + 1; j < places.length; j += 1) expect(crowded(places[i]!.spot, places[j]!.spot), `${places[i]!.role.id} and ${places[j]!.role.id}`).toBe(false);
        }
        // Pairs start at different haunts before any shares one.
        const haunts = places.filter((place) => place.activity === 'chatting').map((place) => place.haunt);
        expect(new Set(haunts).size).toBe(Math.min(Math.floor(count / 2), 4));
      }
    });

    it(`keeps the gate clear of the dock in the ${era}`, () => {
      expect(plan.gate.y + plan.gate.d).toBeLessThanOrEqual(plan.dock.y);
    });

    it(`walks round the furniture, in straight runs, in the ${era}`, () => {
      const spots = [...stations, ...haunts];
      const wrong: string[] = [];
      for (const from of spots) {
        for (const to of spots) {
          const path = findPath(plan, from, to);
          const at = `${JSON.stringify(from)} to ${JSON.stringify(to)}: ${JSON.stringify(path)}`;
          if (path[0] !== from || path.at(-1) !== to) wrong.push(`ends ${at}`);
          // Only straight runs along the floor's axes.
          for (let i = 1; i < path.length; i += 1) if (path[i]!.x !== path[i - 1]!.x && path[i]!.y !== path[i - 1]!.y) wrong.push(`diagonal ${at}`);
          if (along(path).some((p) => boxes.some((b) => inside(b, p)))) wrong.push(`crosses ${at}`);
          if (pathLength(path) > (plan.w + plan.d) * 2.5) wrong.push(`long ${at}`);
        }
      }
      expect(wrong.slice(0, 5)).toEqual([]);
    });
  }
});

describe('the painter\'s order', () => {
  it('draws what is behind first, and an agent on the dock over the dock', () => {
    const desk: Box = { x: 4, y: 2, w: 2, d: 1, h: 0.7 };
    const agentBehind: Box = { x: 4.9, y: 1.4, w: 0.2, d: 0.2, h: 1.5 };
    const agentFront: Box = { x: 4.9, y: 3.6, w: 0.2, d: 0.2, h: 1.5 };
    const dock: Box = { x: 6, y: 4, w: 2.6, d: 2.4, h: 0.25 };
    const onDock: Box = { x: 6.7, y: 5, w: 0.2, d: 0.2, h: 1.5 };
    const boxes = [agentFront, desk, dock, onDock, agentBehind];
    const order = paintOrder(boxes).map((i) => boxes[i]);
    expect(order.indexOf(agentBehind)).toBeLessThan(order.indexOf(desk));
    expect(order.indexOf(desk)).toBeLessThan(order.indexOf(agentFront));
    expect(order.indexOf(dock)).toBeLessThan(order.indexOf(onDock));
  });
});
