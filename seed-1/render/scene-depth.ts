// The diorama's later layers (render/scene.ts owns the island and the units; this draws what the
// layers after the units add to it), in the same line style and under the same determinism rules:
// everything moves by the frame clock passed in and a fixed hash, never Math.random, and under
// prefers-reduced-motion it is drawn still.
//
// - Milestones: a gatherer past its first milestone wears a party hat, a cart flies a pennant, and
//   each building raises a flag on its roof; the colour climbs with the tier (milestoneColour).
// - Weather: rain streaks, breeze lines across the island, heat ribbons rising, or a shooting star
//   crossing above the pile trailing sparkles, faded in and out as the weather turns.
// - Gems: one crystal per unspent gem in a ring around the pile, bobbing.
// - Seasons: flowers bloom across the island, more with every season (render/world.ts flowerSpot).
// - Dust devils: a spinning funnel of sand rings wanders the island while one is here, throwing dust.
// - Forks: a signpost by the track, one plank for each fork chosen this season, pointing the way taken.
// - Orders: a crate with a magenta tag pops up by the pile while the order can be filled.
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Matrix4,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { canFill, devilHere, findUnlock, forkOptions, milestoneTier, ownedCount } from '../sim/sim';
import type { SimConfig, SimState } from '../sim/types';
import { merge, part, Prop } from './toon';
import { devilSpot, easeOutBack, flowerSpot, hash01, ISLAND_HALF, MAX_FLOWERS, milestoneColour, SIGNPOST, UNIT_CAPS } from './world';

const MAX_PLANKS = 8;
// The fork sides' colours, as on their buttons (render/style.css .fork-option).
const SIDE_COLOURS = [0x8db9e8, 0xcbbdee, 0xf1d99c];

function devilGeometry(): BufferGeometry {
  const rings: BufferGeometry[] = [];
  const shades = [0xf1d99c, 0xe2c27f, 0xf8ecc9];
  for (let i = 0; i < 6; i += 1) {
    const k = i / 5;
    const ring = new TorusGeometry(0.16 + k * 0.5, 0.075 + k * 0.03, 6, 18);
    ring.rotateX(Math.PI / 2);
    rings.push(part(ring, shades[i % 3]!, translate(Math.sin(i * 1.7) * 0.06, 0.18 + k * 1.45, Math.cos(i * 1.3) * 0.06)));
  }
  return merge(rings);
}

function postGeometry(): BufferGeometry {
  return merge([part(new CylinderGeometry(0.06, 0.07, 1.7, 6), 0x9a7b55, translate(0, 0.85, 0)), part(new SphereGeometry(0.08, 6, 4), 0x9a7b55, translate(0, 1.72, 0))]);
}

function plankGeometry(): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(-0.05, -0.09);
  shape.lineTo(0.5, -0.09);
  shape.lineTo(0.62, 0);
  shape.lineTo(0.5, 0.09);
  shape.lineTo(-0.05, 0.09);
  shape.lineTo(-0.05, -0.09);
  const g = new ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false });
  g.deleteAttribute('uv');
  g.translate(0, 0, -0.025);
  return merge([part(g, 0xffffff)]);
}

function crateGeometry(): BufferGeometry {
  const tag = new BoxGeometry(0.22, 0.3, 0.03);
  return merge([
    part(new BoxGeometry(0.5, 0.42, 0.5), 0xd9a86c, translate(0, 0.21, 0)),
    part(new BoxGeometry(0.54, 0.06, 0.54), 0x9a7b55, translate(0, 0.44, 0)),
    part(tag, 0xb0226a, translate(0.1, 0.36, 0.27)),
  ]);
}

const MAX_GEMS = 24;
const RAIN = 90;
const WIND = 12;
const HEAT = 26;

const scratch = new Matrix4();
const scratchQ = new Quaternion();
const scratchS = new Vector3();
const scratchP = new Vector3();
const scratchE = new Euler();
const scratchC = new Color();

function compose(x: number, y: number, z: number, rotY: number, sx: number, sy = sx, sz = sx, rotX = 0, rotZ = 0): Matrix4 {
  scratchP.set(x, y, z);
  scratchQ.setFromEuler(scratchE.set(rotX, rotY, rotZ, 'YXZ'));
  scratchS.set(sx, sy, sz);
  return scratch.compose(scratchP, scratchQ, scratchS);
}

function translate(x: number, y: number, z: number): Matrix4 {
  return new Matrix4().makeTranslation(x, y, z);
}

function hatGeometry(): BufferGeometry {
  return merge([part(new ConeGeometry(0.13, 0.3, 10), 0xffffff, translate(0, 0.15, 0)), part(new SphereGeometry(0.05, 8, 6), 0xffffff, translate(0, 0.31, 0))]);
}

function pennantGeometry(): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.34, -0.1);
  shape.lineTo(0, -0.2);
  shape.lineTo(0, 0);
  const cloth = new ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false });
  cloth.deleteAttribute('uv');
  return merge([part(new CylinderGeometry(0.02, 0.02, 0.55, 5), 0x262626, translate(0, 0.27, 0)), part(cloth, 0xffffff, translate(0.02, 0.54, -0.015))]);
}

function gemGeometry(): BufferGeometry {
  const g = new OctahedronGeometry(0.17, 0);
  g.scale(1, 1.55, 1);
  return merge([part(g, 0xffffff)]);
}

function flowerGeometry(): BufferGeometry {
  const parts = [part(new CylinderGeometry(0.018, 0.018, 0.22, 4), 0x5c9e6a, translate(0, 0.11, 0))];
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2;
    parts.push(part(new SphereGeometry(0.06, 6, 4), 0xffffff, translate(Math.cos(a) * 0.07, 0.25, Math.sin(a) * 0.07)));
  }
  parts.push(part(new SphereGeometry(0.045, 6, 4), 0xf5dc7a, translate(0, 0.27, 0)));
  return merge(parts);
}

function starGeometry(): BufferGeometry {
  const shape = new Shape();
  for (let i = 0; i < 10; i += 1) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 0.42 : 0.18;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const g = new ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
  g.deleteAttribute('uv');
  g.translate(0, 0, -0.06);
  return merge([part(g, 0xf5dc7a)]);
}

/** A sparkle the layer asks the scene to throw (the scene owns the particle pool). */
export interface Sparkle {
  at: Vector3;
  colour: number;
}

export class DepthLayer {
  private readonly hats: Prop;
  private readonly pennants: Prop;
  private readonly gems: Prop;
  private readonly flowers: Prop;
  private readonly rain: Prop;
  private readonly wind: Prop;
  private readonly heat: Prop;
  private readonly star: Prop;
  private readonly devil: Prop;
  private readonly post: Prop;
  private readonly planks: Prop;
  private readonly crate: Prop;
  // The dust devil as drawn: how far it has grown in (0 to 1), its path's seed and when it came.
  private devilLevel = 0;
  private devilSeed = 0;
  private devilBorn = 0;
  private crateLevel = 0;
  private planksSeen = -1;
  private plankPopAt = -10;
  private lastSwirl = -10;
  private hatCount = 0;
  private pennantCount = 0;
  // The weather as drawn: the kind shown and how far it has faded in (0 to 1).
  private shownWeather: string | null = null;
  private level = 0;
  private windClock = 0;
  private gemsSeen = -1;
  private readonly gemPopAt: number[] = [];
  private seasonsSeen = -1;
  private flowerPopAt = -10;
  private flowersFrom = 0;
  private lastSparkle = -10;
  /** Where the shooting star is, for the scene's sparkle trail; null when there is none. */
  starAt: Vector3 | null = null;
  /** Where the dust devil's middle is, for a tap on it; null when there is none. */
  devilAt: Vector3 | null = null;

  constructor(
    scene: Scene,
    private readonly config: SimConfig,
    private readonly calm: boolean,
  ) {
    const caps = UNIT_CAPS;
    this.hats = new Prop(hatGeometry(), caps['gatherer']!);
    this.pennants = new Prop(pennantGeometry(), (caps['cart'] ?? 0) + (caps['mill'] ?? 0) + (caps['forge'] ?? 0) + (caps['foundry'] ?? 0));
    this.gems = new Prop(gemGeometry(), MAX_GEMS);
    this.flowers = new Prop(flowerGeometry(), MAX_FLOWERS);
    this.rain = new Prop(new BoxGeometry(0.035, 0.55, 0.035), RAIN, new MeshBasicMaterial({ color: 0x5f93cf }), false);
    this.wind = new Prop(new BoxGeometry(1.5, 0.04, 0.04), WIND, new MeshBasicMaterial({ color: 0x151515, transparent: true, opacity: 0.55 }), false);
    this.heat = new Prop(new BoxGeometry(0.05, 0.7, 0.05), HEAT, new MeshBasicMaterial({ color: 0xf5b97a }), false);
    this.star = new Prop(starGeometry(), 1);
    this.devil = new Prop(devilGeometry(), 1);
    this.post = new Prop(postGeometry(), 1);
    this.planks = new Prop(plankGeometry(), MAX_PLANKS);
    this.crate = new Prop(crateGeometry(), 1);
    for (const prop of [this.flowers, this.gems, this.hats, this.pennants, this.rain, this.wind, this.heat, this.star, this.devil, this.post, this.planks, this.crate]) {
      scene.add(prop.mesh);
      if (prop.outline !== null) scene.add(prop.outline);
    }
  }

  /** The clock the motes drift by: it runs faster in a breeze. */
  get windTime(): number {
    return this.windClock;
  }

  /** Starts a frame: the units' badges are added by hat() and pennant() as the scene places them. */
  begin(): void {
    this.hatCount = 0;
    this.pennantCount = 0;
  }

  /** A hat on a gatherer past its first milestone, at the gatherer's head. */
  hat(state: SimState, x: number, y: number, z: number, heading: number, pop: number, tilt: number): void {
    const tier = milestoneTier(this.config, ownedCount(state, 'gatherer'));
    if (tier === 0 || this.hatCount >= this.hats.capacity) return;
    this.hats.set(this.hatCount, compose(x, y + 0.66 * pop, z, heading, pop, pop, pop, 0, tilt - 0.25));
    this.hats.colour(this.hatCount, scratchC.set(milestoneColour(tier)));
    this.hatCount += 1;
  }

  /** A pennant on a unit (a cart or a building) past its first milestone; `top` is where it stands. */
  pennant(state: SimState, unit: string, top: Vector3, heading: number, pop: number, t: number): void {
    const tier = milestoneTier(this.config, ownedCount(state, unit));
    if (tier === 0 || this.pennantCount >= this.pennants.capacity) return;
    const flutter = this.calm ? 0 : Math.sin(t * 4 + top.x * 3) * 0.25;
    this.pennants.set(this.pennantCount, compose(top.x, top.y, top.z, heading + 0.6 + flutter, pop * 1.2));
    this.pennants.colour(this.pennantCount, scratchC.set(milestoneColour(tier)));
    this.pennantCount += 1;
  }

  /** Ends the frame: everything this layer draws, from the state and the frame clock. */
  update(state: SimState, time: number, dt: number, pileShown: number): Sparkle[] {
    const sparkles: Sparkle[] = [];
    const t = this.calm ? 0 : time;
    this.hats.commit(this.hatCount);
    this.pennants.commit(this.pennantCount);

    // Gems: one crystal per unspent gem, ringed round the pile's foot; new ones pop in.
    const gems = Math.min(MAX_GEMS, state.gems ?? 0);
    if (this.gemsSeen < 0) this.gemsSeen = gems;
    for (let i = this.gemsSeen; i < gems; i += 1) this.gemPopAt[i] = time + (i - this.gemsSeen) * 0.08;
    this.gemsSeen = gems;
    const ring = pileShown * 1.08 + 0.55;
    for (let i = 0; i < gems; i += 1) {
      const a = (i / Math.max(gems, 8)) * Math.PI * 2 + 0.4;
      const born = this.gemPopAt[i];
      const pop = born === undefined || this.calm ? 1 : Math.max(0, easeOutBack(Math.min(1, (time - born) / 0.5)));
      const bob = this.calm ? 0 : Math.sin(t * 2 + i) * 0.06;
      this.gems.set(i, compose(Math.cos(a) * ring, 0.3 + bob, Math.sin(a) * ring, t * 0.8 + i, pop));
      this.gems.colour(i, scratchC.set([0xcbbdee, 0x7fcbc5, 0xf3b0c6][i % 3]!));
    }
    this.gems.commit(gems);

    // Flowers: more with every season.
    const seasons = state.season ?? 0;
    const flowers = Math.min(MAX_FLOWERS, seasons * 6);
    if (this.seasonsSeen < 0) this.flowersFrom = flowers;
    else if (seasons !== this.seasonsSeen) {
      this.flowerPopAt = time;
      this.flowersFrom = Math.min(this.flowersFrom, flowers);
    }
    this.seasonsSeen = seasons;
    for (let i = 0; i < flowers; i += 1) {
      const spot = flowerSpot(i);
      const late = i >= this.flowersFrom && !this.calm;
      const pop = late ? Math.max(0, easeOutBack(Math.min(1, (time - this.flowerPopAt - (i - this.flowersFrom) * 0.05) / 0.5))) : 1;
      this.flowers.set(i, compose(spot.x, 0, spot.z, spot.rot, spot.scale * pop));
      this.flowers.colour(i, scratchC.set([0xf3b0c6, 0xcbbdee, 0x8db9e8, 0xf5b97a, 0xffffff][i % 5]!));
    }
    this.flowers.commit(flowers);

    // Weather: fade the old kind out before the new one fades in.
    const kind = state.weather?.kind ?? null;
    if (this.calm) {
      this.shownWeather = kind;
      this.level = kind === null ? 0 : 1;
    } else if (kind === this.shownWeather) {
      this.level = Math.min(1, this.level + dt * 1.2);
    } else {
      this.level = Math.max(0, this.level - dt * 2);
      if (this.level === 0) this.shownWeather = kind;
    }
    const shown = this.shownWeather;
    const level = this.level;
    this.windClock += dt * (1 + (shown === 'breeze' ? 3 * level : 0));

    let n = 0;
    if (shown === 'rain' && level > 0) {
      for (let i = 0; i < RAIN; i += 1) {
        const x = (hash01(i * 7 + 11) - 0.5) * ISLAND_HALF * 2;
        const z = (hash01(i * 7 + 12) - 0.5) * ISLAND_HALF * 2;
        const fall = this.calm ? hash01(i * 7 + 13) : (t * 1.6 + hash01(i * 7 + 13)) % 1;
        const y = 6.5 - fall * 6.5;
        this.rain.set(n, compose(x - fall * 0.6, y, z + fall * 0.6, 0, level, level, level, 0.15, 0.15));
        n += 1;
      }
    }
    this.rain.commit(n);

    n = 0;
    if (shown === 'breeze' && level > 0) {
      for (let i = 0; i < WIND; i += 1) {
        const across = this.calm ? hash01(i * 5 + 1) : (t * 0.35 + hash01(i * 5 + 1)) % 1;
        const s = (across - 0.5) * 16;
        const side = (hash01(i * 5 + 2) - 0.5) * 9;
        const y = 0.7 + hash01(i * 5 + 3) * 2.6 + Math.sin(across * 9 + i) * 0.15;
        // Screen-right is (+1, 0, -1) for this camera; lines run along it and spread toward the viewer.
        const x = s * 0.7071 + side * 0.7071;
        const z = -s * 0.7071 + side * 0.7071;
        const fade = Math.sin(across * Math.PI) * level;
        this.wind.set(n, compose(x, y, z, Math.PI / 4, fade, 1, 1));
        n += 1;
      }
    }
    this.wind.commit(n);

    n = 0;
    if (shown === 'heatwave' && level > 0) {
      for (let i = 0; i < HEAT; i += 1) {
        const x = (hash01(i * 3 + 70) - 0.5) * ISLAND_HALF * 1.8;
        const z = (hash01(i * 3 + 71) - 0.5) * ISLAND_HALF * 1.8;
        const rise = this.calm ? hash01(i * 3 + 72) : (t * 0.45 + hash01(i * 3 + 72)) % 1;
        const size = Math.sin(rise * Math.PI) * level;
        this.heat.set(n, compose(x + Math.sin(t * 3 + i) * 0.12, 0.4 + rise * 3, z, 0, size, size, size, 0, Math.sin(t * 2.5 + i) * 0.4));
        n += 1;
      }
    }
    this.heat.commit(n);

    this.starAt = null;
    if (shown === 'shooting-star' && level > 0) {
      // Across the sky above the pile, left to right on screen, once every few seconds.
      const k = this.calm ? 0.62 : (t / 4.5) % 1;
      const s = (k - 0.5) * 18;
      const at = new Vector3(s * 0.7071, 3.3 + Math.sin(k * Math.PI) * 0.8, -s * 0.7071);
      this.star.set(0, compose(at.x, at.y, at.z, Math.PI / 4, level * 1.1, level * 1.1, level * 1.1, 0, t * 5));
      this.star.commit(1);
      this.starAt = at;
      if (!this.calm && time - this.lastSparkle > 0.05) {
        this.lastSparkle = time;
        sparkles.push({ at, colour: 0xf5dc7a });
      }
    } else {
      this.star.commit(0);
    }
    this.drawDevil(state, time, dt, t, sparkles);
    this.drawSignpost(state, time);
    this.drawCrate(state, dt, t, pileShown);
    return sparkles;
  }

  // The dust devil: it grows in where it arrives, spins and wanders while it stays, and shrinks away
  // when it goes or is caught. Under reduced motion it stands still, unspun.
  private drawDevil(state: SimState, time: number, dt: number, t: number, sparkles: Sparkle[]): void {
    const here = devilHere(state);
    if (here && this.devilLevel === 0) {
      this.devilSeed = Math.round(state.devil!.until);
      this.devilBorn = time;
    }
    this.devilLevel = this.calm ? (here ? 1 : 0) : Math.max(0, Math.min(1, this.devilLevel + (here ? dt * 2.5 : -dt * 3)));
    this.devilAt = null;
    if (this.devilLevel <= 0) {
      this.devil.commit(0);
      return;
    }
    const age = this.calm ? 0 : time - this.devilBorn;
    const spot = devilSpot(this.devilSeed, age);
    const grow = this.calm ? 1 : easeOutBack(this.devilLevel);
    const lean = this.calm ? 0 : Math.sin(t * 2.3) * 0.12;
    this.devil.set(0, compose(spot.x, 0, spot.z, this.calm ? 0 : -t * 7, grow, grow, grow, lean, Math.cos(t * 1.9) * 0.1));
    this.devil.commit(1);
    if (here) this.devilAt = new Vector3(spot.x, 0.9 * grow, spot.z);
    if (!this.calm && here && time - this.lastSwirl > 0.07) {
      this.lastSwirl = time;
      const a = t * 9;
      sparkles.push({ at: new Vector3(spot.x + Math.cos(a) * 0.55, 0.3 + hash01(Math.floor(time * 20)) * 1.2, spot.z + Math.sin(a) * 0.55), colour: 0xe2c27f });
    }
  }

  // The signpost: one plank for each fork chosen this season, top down in the order the forks opened,
  // pointing left for the first option, right for the second, and out front for a third.
  private drawSignpost(state: SimState, time: number): void {
    const sides: number[] = [];
    for (const event of state.unlocked) {
      const id = state.chosen?.[event.id];
      const row = id === undefined ? null : findUnlock(this.config, event.id);
      const options = row === null ? null : forkOptions(row);
      if (options === null) continue;
      sides.push(Math.max(0, options.findIndex((option) => option.id === id)));
    }
    const count = Math.min(MAX_PLANKS, sides.length);
    if (this.planksSeen >= 0 && count > this.planksSeen) this.plankPopAt = time;
    this.planksSeen = count;
    if (count === 0) {
      this.post.commit(0);
      this.planks.commit(0);
      return;
    }
    this.post.set(0, compose(SIGNPOST.x, 0, SIGNPOST.z, 0, 1));
    this.post.commit(1);
    for (let i = 0; i < count; i += 1) {
      const side = sides[i]!;
      // Screen-left along the island is (-1, 0, +1) for this camera, screen-right (+1, 0, -1).
      const heading = side === 0 ? Math.PI * 0.75 : side === 1 ? -Math.PI * 0.25 : Math.PI * 0.25;
      const newest = i === count - 1 && !this.calm;
      const pop = newest ? Math.max(0, easeOutBack(Math.min(1, (time - this.plankPopAt) / 0.5))) : 1;
      this.planks.set(i, compose(SIGNPOST.x, 1.5 - i * 0.2, SIGNPOST.z, heading, pop));
      this.planks.colour(i, scratchC.set(SIDE_COLOURS[side] ?? SIDE_COLOURS[0]!));
    }
    this.planks.commit(count);
  }

  // The order crate: up by the pile's foot while the order can be filled, bobbing a little.
  private drawCrate(state: SimState, dt: number, t: number, pileShown: number): void {
    const ready = canFill(state, this.config);
    this.crateLevel = this.calm ? (ready ? 1 : 0) : Math.max(0, Math.min(1, this.crateLevel + (ready ? dt * 3 : -dt * 4)));
    if (this.crateLevel <= 0) {
      this.crate.commit(0);
      return;
    }
    const r = pileShown * 1.05 + 0.45;
    const hop = this.calm ? 0 : Math.abs(Math.sin(t * 3)) * 0.12;
    const s = this.calm ? 1 : easeOutBack(this.crateLevel);
    this.crate.set(0, compose(r * 0.7071, hop, r * 0.7071, 0.5, s));
    this.crate.commit(1);
  }
}
