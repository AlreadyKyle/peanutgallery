// The Three.js diorama: a small square quarry island seen from above at an angle, in the studio's line
// style (render/toon.ts). The dust pile in the middle grows with lifetime dust; gatherers walk lanes
// to it with sacks, carts roll on a track around it, mills turn at the right, forges glow at the left
// and foundries smoke at the back. Each unit appears, with a pop, as it is bought, up to the caps in
// render/world.ts. A strike squashes the pile and throws dust; an unlock throws up a cloud of dust
// puffs, outlined like everything else, and an ink ring runs out across the ground from the pile.
//
// Everything moves as a function of the frame clock passed to frame() and of a fixed hash, never
// Math.random, so the same state at the same clock draws the same pixels (e2e/frames.spec.ts).
// Under prefers-reduced-motion nothing walks, turns, drifts or flies; the scene is drawn still.
import {
  AmbientLight,
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DirectionalLight,
  DodecahedronGeometry,
  Euler,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  OrthographicCamera,
  Points,
  PointsMaterial,
  Quaternion,
  RGBAFormat,
  Scene,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
} from 'three';
import { ownedCount } from '../sim/sim';
import type { SimConfig, SimState } from '../sim/types';
import { DepthLayer } from './scene-depth';
import { addSmoothNormals, INK, merge, outlineMaterial, outlineUniform, part, Prop, toonMaterial } from './toon';
import {
  CART_ORDER,
  easeOutBack,
  gathererPath,
  gathererPhase,
  hash01,
  ISLAND_HALF,
  pileScale,
  shownCount,
  SIGNPOST,
  STRUCTURE_SLOTS,
  TRACK_RADIUS,
  UNIT_CAPS,
  type Slot,
} from './world';

// The site's creature fills (platform/site/src/tokens.css) and the Dust suit's magenta.
export const PALETTE = {
  paper: 0xfdfcf8,
  ground: 0xf6f2e8,
  path: 0xece5d4,
  side: 0xe6dccb,
  sand: 0xf1d99c,
  sandDeep: 0xe3c37e,
  blue: 0x8db9e8,
  lavender: 0xcbbdee,
  green: 0x9bd3a6,
  pink: 0xf3b0c6,
  orange: 0xf5b97a,
  yellow: 0xf5dc7a,
  grey: 0xc3c7cc,
  teal: 0x7fcbc5,
  brown: 0xcfa77c,
  magenta: 0xb0226a,
  ink: INK,
};

const CREATURES = [PALETTE.blue, PALETTE.lavender, PALETTE.green, PALETTE.pink, PALETTE.orange, PALETTE.yellow];

export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const UP = new Vector3(0, 1, 0);
// Looking down about 31 degrees on a wide screen, and steeper on a tall one, where the island has the
// height to spare and a flatter view would leave it a thin strip.
const WIDE_LIFT = 0.86;
const TALL_LIFT = 1.45;
const CAMERA_DISTANCE = 40;
// The box the framing keeps in view: the island and the tallest chimney.
const FRAME_BOX = { half: ISLAND_HALF + 0.2, low: -1.6, high: 2.0 };

const CHUNKS = 90;
// The big moments' dust puffs (an unlock, a press, a milestone, a catch, a fork) share one pool.
const PUFFS = 90;
// The ink ring a big moment sends across the ground: dashes of ink line, a few rings at once.
const RING_DASHES = 22;
const RINGS = 3;
const POP_SECONDS = 0.5;

const scratch = new Matrix4();
const scratchQ = new Quaternion();
const scratchS = new Vector3();
const scratchP = new Vector3();
const scratchC = new Color();
const scratchE = new Euler();

function compose(x: number, y: number, z: number, rotY: number, sx: number, sy = sx, sz = sx, rotX = 0, rotZ = 0): Matrix4 {
  scratchP.set(x, y, z);
  scratchQ.setFromEuler(scratchE.set(rotX, rotY, rotZ, 'YXZ'));
  scratchS.set(sx, sy, sz);
  return scratch.compose(scratchP, scratchQ, scratchS);
}

function translate(x: number, y: number, z: number): Matrix4 {
  return new Matrix4().makeTranslation(x, y, z);
}

function roundedSquare(half: number, radius: number): Shape {
  const s = new Shape();
  s.moveTo(-half + radius, -half);
  s.lineTo(half - radius, -half);
  s.quadraticCurveTo(half, -half, half, -half + radius);
  s.lineTo(half, half - radius);
  s.quadraticCurveTo(half, half, half - radius, half);
  s.lineTo(-half + radius, half);
  s.quadraticCurveTo(-half, half, -half, half - radius);
  s.lineTo(-half, -half + radius);
  s.quadraticCurveTo(-half, -half, -half + radius, -half);
  return s;
}

// A slab of the island's outline shape, its top at y = 0, coloured top and side apart.
function slab(half: number, radius: number, depth: number, top: number, side: number): BufferGeometry {
  // Flat faces so the top and the sides take their own normals. An extrusion is already non-indexed, and
  // calling toNonIndexed on it anyway warned in the console three times a load.
  const extruded = new ExtrudeGeometry(roundedSquare(half, radius), { depth, bevelEnabled: false, curveSegments: 5 });
  const geometry = extruded.index === null ? extruded : extruded.toNonIndexed();
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -depth, 0);
  geometry.deleteAttribute('uv');
  geometry.computeVertexNormals();
  const normal = geometry.attributes['normal']!;
  const colours = new Float32Array(normal.count * 3);
  const topC = new Color(top);
  const sideC = new Color(side);
  for (let i = 0; i < normal.count; i += 1) {
    const c = normal.getY(i) > 0.5 ? topC : sideC;
    colours.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
  return geometry;
}

function islandGeometry(): BufferGeometry {
  return merge([slab(ISLAND_HALF, 1.3, 1.5, PALETTE.ground, PALETTE.side)]);
}

function strataGeometry(): BufferGeometry {
  const ring = (y: number): BufferGeometry => {
    const g = slab(ISLAND_HALF + 0.02, 1.32, 0.06, PALETTE.ink, PALETTE.ink);
    g.translate(0, y, 0);
    return g;
  };
  return merge([ring(-0.55), ring(-1.0)]);
}

function lumpy(geometry: BufferGeometry, amount: number, seed: number): BufferGeometry {
  const position = geometry.attributes['position']!;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + amount * (Math.sin(a * 5 + seed) * 0.6 + Math.sin(a * 9 + seed * 2.3) * 0.4);
    position.setX(i, x * k);
    position.setZ(i, z * k);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function pileGeometry(): BufferGeometry {
  const profile = [
    [0.0, 1.0],
    [0.2, 0.98],
    [0.38, 0.9],
    [0.55, 0.74],
    [0.7, 0.54],
    [0.84, 0.3],
    [0.95, 0.1],
    [1.0, 0.0],
  ]
    .reverse()
    .map(([x, y]) => new Vector2(Math.max(0.001, x!), y!));
  const lathe = lumpy(new LatheGeometry(profile, 18), 0.06, 1.3);
  const parts: BufferGeometry[] = [part(lathe, PALETTE.sand)];
  // An ink line where the pile meets the ground, which the outline hull cannot draw there.
  const ring = new TorusGeometry(1.0, 0.025, 4, 48);
  ring.rotateX(Math.PI / 2);
  parts.push(part(ring, PALETTE.ink, translate(0, 0.02, 0)));
  // Loose lumps around the foot of the pile.
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2 + hash01(i + 40) * 0.4;
    const r = 1.02 + hash01(i + 60) * 0.22;
    const s = 0.07 + hash01(i + 80) * 0.07;
    parts.push(part(new IcosahedronGeometry(1, 0), i % 3 === 0 ? PALETTE.sandDeep : PALETTE.sand, compose(Math.cos(a) * r, s * 0.6, Math.sin(a) * r, a, s).clone()));
  }
  return merge(parts);
}

function flagGeometry(): BufferGeometry {
  const pole = part(new CylinderGeometry(0.025, 0.025, 0.95, 6), PALETTE.ink, translate(0, 0.47, 0));
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.5, -0.14);
  shape.lineTo(0, -0.3);
  shape.lineTo(0, 0);
  const cloth = new ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false });
  cloth.deleteAttribute('uv');
  const flag = part(cloth, PALETTE.magenta, translate(0.02, 0.93, -0.015));
  return merge([pole, flag]);
}

function treeGeometry(): BufferGeometry {
  return merge([
    part(new CylinderGeometry(0.07, 0.1, 0.55, 6), PALETTE.brown, translate(0, 0.27, 0)),
    part(new SphereGeometry(0.42, 12, 8), PALETTE.green, translate(0, 0.8, 0)),
    part(new SphereGeometry(0.26, 10, 6), PALETTE.green, translate(0.22, 1.08, 0.08)),
  ]);
}

function rockGeometry(): BufferGeometry {
  const g = new DodecahedronGeometry(0.32, 0);
  g.scale(1, 0.6, 0.85);
  g.translate(0, 0.12, 0);
  return merge([part(g, PALETTE.grey)]);
}

function gathererGeometry(): BufferGeometry {
  const body = new SphereGeometry(0.27, 14, 10);
  body.scale(1, 1.25, 1);
  return merge([
    part(body, 0xffffff, translate(0, 0.38, 0)),
    part(new SphereGeometry(0.045, 6, 4), PALETTE.ink, translate(0.09, 0.47, 0.24)),
    part(new SphereGeometry(0.045, 6, 4), PALETTE.ink, translate(-0.09, 0.47, 0.24)),
    part(new CylinderGeometry(0.014, 0.014, 0.2, 4), PALETTE.ink, translate(0, 0.78, 0)),
    part(new SphereGeometry(0.055, 8, 6), 0xffffff, translate(0, 0.89, 0)),
    part(new SphereGeometry(0.07, 6, 4), PALETTE.ink, translate(0.12, 0.05, 0)),
    part(new SphereGeometry(0.07, 6, 4), PALETTE.ink, translate(-0.12, 0.05, 0)),
  ]).scale(0.85, 0.85, 0.85);
}

function sackGeometry(): BufferGeometry {
  const g = new SphereGeometry(0.19, 10, 8);
  g.scale(1, 0.9, 0.85);
  return merge([part(g, PALETTE.sandDeep), part(new CylinderGeometry(0.05, 0.07, 0.07, 6), PALETTE.brown, translate(0, 0.17, 0))]);
}

function cartGeometry(): BufferGeometry {
  const load = new SphereGeometry(0.3, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  load.scale(1.15, 0.45, 0.75);
  const parts = [part(new BoxGeometry(0.78, 0.3, 0.5), PALETTE.orange, translate(0, 0.33, 0)), part(load, PALETTE.sand, translate(0, 0.47, 0))];
  for (const [x, z] of [
    [0.26, 0.27],
    [-0.26, 0.27],
    [0.26, -0.27],
    [-0.26, -0.27],
  ] as const) {
    parts.push(part(new CylinderGeometry(0.12, 0.12, 0.06, 10), PALETTE.ink, new Matrix4().makeTranslation(x, 0.13, z).multiply(new Matrix4().makeRotationX(Math.PI / 2))));
  }
  return merge(parts);
}

function trackGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const sleepers = 40;
  for (let i = 0; i < sleepers; i += 1) {
    const a = (i / sleepers) * Math.PI * 2;
    parts.push(part(new BoxGeometry(0.62, 0.04, 0.13), PALETTE.brown, new Matrix4().makeTranslation(Math.cos(a) * TRACK_RADIUS, 0.02, Math.sin(a) * TRACK_RADIUS).multiply(new Matrix4().makeRotationY(-a))));
  }
  return merge(parts);
}

function railsGeometry(): BufferGeometry {
  const rail = (r: number): BufferGeometry => {
    const g = new TorusGeometry(r, 0.035, 4, 96);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.07, 0);
    return part(g, PALETTE.ink);
  };
  return merge([rail(TRACK_RADIUS - 0.2), rail(TRACK_RADIUS + 0.2)]);
}

function millGeometry(): BufferGeometry {
  return merge([
    part(new CylinderGeometry(0.42, 0.62, 1.35, 8), PALETTE.paper, translate(0, 0.67, 0)),
    part(new ConeGeometry(0.62, 0.62, 8), PALETTE.blue, translate(0, 1.66, 0)),
    part(new BoxGeometry(0.26, 0.42, 0.08), PALETTE.ink, translate(0, 0.21, 0.56)),
    part(new BoxGeometry(0.16, 0.18, 0.06), PALETTE.blue, translate(0, 0.86, 0.47)),
    part(new CylinderGeometry(0.06, 0.06, 0.3, 6), PALETTE.ink, new Matrix4().makeTranslation(0, 1.3, 0.52).multiply(new Matrix4().makeRotationX(Math.PI / 2))),
  ]);
}

function sailsGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 4; i += 1) {
    const turn = new Matrix4().makeRotationZ((i * Math.PI) / 2);
    parts.push(part(new BoxGeometry(0.06, 1.2, 0.05), PALETTE.brown, turn.clone().multiply(translate(0, 0.6, 0))));
    parts.push(part(new BoxGeometry(0.3, 0.82, 0.03), PALETTE.paper, turn.clone().multiply(translate(0.18, 0.7, 0))));
  }
  parts.push(part(new SphereGeometry(0.1, 8, 6), PALETTE.magenta));
  return merge(parts);
}

function forgeGeometry(): BufferGeometry {
  const roof = new CylinderGeometry(0.01, 0.82, 0.5, 4, 1);
  roof.rotateY(Math.PI / 4);
  roof.scale(1.08, 1, 0.9);
  return merge([
    part(new BoxGeometry(1.1, 0.72, 0.9), PALETTE.grey, translate(0, 0.36, 0)),
    part(roof, PALETTE.orange, translate(0, 0.97, 0)),
    part(new CylinderGeometry(0.13, 0.15, 0.9, 8), PALETTE.paper, translate(-0.3, 1.2, -0.22)),
    part(new CylinderGeometry(0.155, 0.155, 0.1, 8), PALETTE.ink, translate(-0.3, 1.6, -0.22)),
    part(new BoxGeometry(0.46, 0.36, 0.04), PALETTE.ink, translate(0.08, 0.26, 0.46)),
    part(new BoxGeometry(0.3, 0.12, 0.16), PALETTE.ink, translate(0.08, 0.2, 0.92)),
    part(new BoxGeometry(0.12, 0.12, 0.1), PALETTE.ink, translate(0.08, 0.08, 0.92)),
  ]);
}

function glowGeometry(): BufferGeometry {
  return new BoxGeometry(0.36, 0.26, 0.03).translate(0.08, 0.25, 0.485);
}

function foundryGeometry(): BufferGeometry {
  const parts = [
    part(new BoxGeometry(1.8, 1.0, 1.3), PALETTE.lavender, translate(0, 0.5, 0)),
    part(new BoxGeometry(0.42, 0.56, 0.06), PALETTE.ink, translate(0.3, 0.28, 0.66)),
    part(new BoxGeometry(0.3, 0.2, 0.05), PALETTE.yellow, translate(-0.45, 0.6, 0.66)),
  ];
  // A saw-tooth roof of three ridges.
  for (let i = 0; i < 3; i += 1) {
    const ridge = new CylinderGeometry(0.34, 0.34, 1.3, 3, 1);
    ridge.rotateX(Math.PI / 2);
    ridge.rotateZ(Math.PI / 2);
    ridge.scale(1, 0.9, 1);
    parts.push(part(ridge, PALETTE.pink, translate(-0.6 + i * 0.6, 1.14, 0)));
  }
  for (const x of [-0.5, 0.45]) {
    parts.push(part(new CylinderGeometry(0.16, 0.2, 1.7, 10), PALETTE.paper, translate(x, 1.65, -0.38)));
    parts.push(part(new CylinderGeometry(0.205, 0.205, 0.14, 10), PALETTE.magenta, translate(x, 2.3, -0.38)));
  }
  return merge(parts);
}

function plotGeometry(): BufferGeometry {
  const parts = [part(new BoxGeometry(1.0, 0.04, 1.0), PALETTE.path, translate(0, 0.02, 0))];
  for (const [x, z] of [
    [0.48, 0.48],
    [-0.48, 0.48],
    [0.48, -0.48],
    [-0.48, -0.48],
  ] as const) {
    parts.push(part(new CylinderGeometry(0.025, 0.025, 0.28, 4), PALETTE.ink, translate(x, 0.14, z)));
  }
  return merge(parts);
}

function groundGeometry(): BufferGeometry {
  // A worn clearing around the pile and a scatter of grass tufts.
  const clearing = new CircleGeometry(3.05, 48);
  clearing.rotateX(-Math.PI / 2);
  const parts: BufferGeometry[] = [part(clearing, PALETTE.path, translate(0, 0.004, 0))];
  for (let i = 0; i < 46; i += 1) {
    const x = (hash01(i * 5 + 500) - 0.5) * ISLAND_HALF * 1.86;
    const z = (hash01(i * 5 + 501) - 0.5) * ISLAND_HALF * 1.86;
    if (Math.hypot(x, z) < 4.0) continue;
    const blade = new ConeGeometry(0.05, 0.22, 3);
    for (const dx of [-0.06, 0, 0.06]) parts.push(part(blade.clone(), 0x7fb98a, new Matrix4().makeTranslation(x + dx, 0.1, z).multiply(new Matrix4().makeRotationZ(-dx * 4))));
  }
  return merge(parts);
}

function pondGeometry(): BufferGeometry {
  const water = new CylinderGeometry(0.95, 0.95, 0.04, 28);
  water.scale(1, 1, 0.75);
  const parts = [part(water, PALETTE.blue, translate(0, 0.02, 0))];
  for (const [x, z] of [
    [0.75, 0.3],
    [0.85, 0.05],
    [0.65, 0.45],
  ] as const) {
    parts.push(part(new CylinderGeometry(0.02, 0.02, 0.4, 4), 0x5c9e6a, translate(x, 0.2, z)));
  }
  return merge(parts).translate(4.1, 0, 2.85);
}

const TREES: ReadonlyArray<readonly [number, number, number]> = [
  [4.75, 4.55, 1.05],
  [3.35, 5.25, 0.8],
  [5.3, 3.15, 0.9],
  [5.35, 1.1, 0.7],
  [0.95, 5.35, 0.75],
  [-2.95, -5.3, 0.85],
  [-5.35, -2.85, 0.7],
  [-5.3, 3.2, 0.65],
  [3.3, -5.35, 0.7],
];
const ROCKS: ReadonlyArray<readonly [number, number, number]> = [
  [2.4, 4.4, 1.0],
  [1.4, 4.6, 0.8],
  [-2.8, 2.6, 0.7],
  [2.6, -2.5, 0.75],
  [-2.4, -2.6, 0.9],
  [5.25, -3.0, 0.6],
];

function sceneryGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const tree = treeGeometry();
  const rock = rockGeometry();
  TREES.forEach(([x, z, s], i) => {
    const g = tree.clone();
    g.deleteAttribute('smoothNormal');
    g.applyMatrix4(compose(x, 0, z, hash01(i + 300) * 6, s).clone());
    parts.push(g);
  });
  ROCKS.forEach(([x, z, s], i) => {
    const g = rock.clone();
    g.deleteAttribute('smoothNormal');
    g.applyMatrix4(compose(x, 0, z, hash01(i + 400) * 6, s).clone());
    parts.push(g);
  });
  return merge(parts);
}

function dotTexture(): DataTexture {
  const size = 16;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const a = Math.max(0, Math.min(1, (1 - d) * 3));
      data.set([255, 255, 255, Math.round(a * 255)], (y * size + x) * 4);
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

interface Chunk {
  born: number;
  life: number;
  p: Vector3;
  v: Vector3;
  spin: number;
  size: number;
  colour: number;
}

interface Ring {
  born: number;
  life: number;
  at: Vector3;
  from: number;
  to: number;
}

function outlined(geometry: BufferGeometry, material = toonMaterial()): Group {
  const group = new Group();
  if (geometry.getAttribute('smoothNormal') === undefined) addSmoothNormals(geometry);
  group.add(new Mesh(geometry, material), new Mesh(geometry, outlineMaterial()));
  return group;
}

export class DustScene {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 1, 120);
  private width = 1;
  private height = 1;
  private safe: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };
  // Frustum before breathing and punches: centre (camera right/up units) and units per CSS pixel.
  private frame0 = { cx: 0, cy: 0, unitsPerPx: 0.05, sx: 0.5, sy: 0.5 };
  private direction = new Vector3(1, WIDE_LIFT, 1).normalize();

  private state: SimState | null = null;
  private time = 0;
  private lastTime: number | null = null;

  private readonly pile = new Group();
  private readonly flag: Group;
  private pileShown = 0;
  private squashAt = -10;
  private squashPower = 0;
  private punchAt = -10;
  private punchPower = 1;
  private readonly depth: DepthLayer;

  private readonly track = new Group();
  private readonly gatherers: Prop;
  private readonly sacks: Prop;
  private readonly carts: Prop;
  private readonly mills: Prop;
  private readonly sails: Prop;
  private readonly forges: Prop;
  private readonly glows: Prop;
  private readonly glowMaterial: MeshBasicMaterial;
  private readonly sparks: Prop;
  private readonly foundries: Prop;
  private readonly smoke: Prop;
  private readonly plots: Prop;
  private readonly shadows: Prop;
  private readonly chunkProp: Prop;
  private readonly puffProp: Prop;
  private readonly ringProp: Prop;
  private readonly motes: Points;
  private readonly motePositions: Float32Array;

  private readonly chunks: Chunk[] = [];
  private readonly puffs: Chunk[] = [];
  private readonly rings: Ring[] = [];
  private fxSeed = 1;
  // When each drawn unit popped in, by unit and index; absent means it was there from the start.
  private readonly popAt = new Map<string, number[]>();
  private readonly bumpAt = new Map<string, number>();

  constructor(
    host: HTMLElement,
    private readonly config: SimConfig,
    private readonly calm: boolean,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;
    host.append(this.canvas);

    this.scene.add(new AmbientLight(0xffffff, 2.35));
    const sun = new DirectionalLight(0xffffff, 1.35);
    sun.position.set(-5, 10, 7);
    this.scene.add(sun);

    // The island, its strata lines and a flat shadow on the paper beneath it.
    const shadow = new Mesh(new ExtrudeGeometry(roundedSquare(ISLAND_HALF, 1.3), { depth: 0.01, bevelEnabled: false }).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.07, depthWrite: false }));
    shadow.position.set(0.9, -2.2, 0.9);
    this.scene.add(shadow);
    this.scene.add(outlined(islandGeometry()));
    this.scene.add(new Mesh(strataGeometry(), new MeshBasicMaterial({ color: PALETTE.ink })));
    this.scene.add(new Mesh(groundGeometry(), toonMaterial()));
    this.scene.add(outlined(pondGeometry()));
    this.scene.add(outlined(sceneryGeometry()));

    // The track appears with the first cart.
    this.track.add(outlined(trackGeometry()), new Mesh(railsGeometry(), new MeshBasicMaterial({ color: PALETTE.ink })));
    this.track.visible = false;
    this.scene.add(this.track);

    // The pile and its flag.
    this.pile.add(outlined(pileGeometry()));
    this.flag = outlined(flagGeometry());
    this.flag.position.y = 0.97;
    this.pile.add(this.flag);
    this.scene.add(this.pile);

    const shadowMaterial = new MeshBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.11, depthWrite: false });
    this.shadows = new Prop(new CircleGeometry(0.5, 20).rotateX(-Math.PI / 2).translate(0, 0.012, 0), 64, shadowMaterial, false);
    this.plots = new Prop(plotGeometry(), 3);
    this.gatherers = new Prop(gathererGeometry(), UNIT_CAPS['gatherer']!);
    this.sacks = new Prop(sackGeometry(), UNIT_CAPS['gatherer']!);
    this.carts = new Prop(cartGeometry(), UNIT_CAPS['cart']!);
    this.mills = new Prop(millGeometry(), UNIT_CAPS['mill']!);
    this.sails = new Prop(sailsGeometry(), UNIT_CAPS['mill']!);
    this.forges = new Prop(forgeGeometry(), UNIT_CAPS['forge']!);
    this.glowMaterial = new MeshBasicMaterial({ color: PALETTE.orange });
    this.glows = new Prop(glowGeometry(), UNIT_CAPS['forge']!, this.glowMaterial, false);
    this.sparks = new Prop(new BoxGeometry(0.06, 0.06, 0.06), UNIT_CAPS['forge']! * 6, new MeshBasicMaterial({ color: PALETTE.yellow }), false);
    this.foundries = new Prop(foundryGeometry(), UNIT_CAPS['foundry']!);
    this.smoke = new Prop(merge([part(new IcosahedronGeometry(0.24, 1), PALETTE.paper)]), UNIT_CAPS['foundry']! * 2 * 3);
    this.chunkProp = new Prop(merge([part(new OctahedronGeometry(1, 0), 0xffffff)]), CHUNKS);
    // A puff is a low ball like the strike chunks (20 faces, so a full pool adds under 4,000 triangles
    // with its outline), toon-filled and outlined; a ring dash is a bar of ink.
    this.puffProp = new Prop(merge([part(new IcosahedronGeometry(1, 0), 0xffffff)]), PUFFS);
    this.ringProp = new Prop(new BoxGeometry(1, 1, 1), RING_DASHES * RINGS, new MeshBasicMaterial({ color: PALETTE.ink }), false);
    for (const prop of [this.shadows, this.plots, this.gatherers, this.sacks, this.carts, this.mills, this.sails, this.forges, this.glows, this.sparks, this.foundries, this.smoke, this.chunkProp, this.puffProp, this.ringProp]) {
      this.scene.add(prop.mesh);
      if (prop.outline !== null) this.scene.add(prop.outline);
    }
    for (let i = 0; i < UNIT_CAPS['gatherer']!; i += 1) this.gatherers.colour(i, scratchC.set(CREATURES[gathererPath(i).colour]!));
    this.depth = new DepthLayer(this.scene, config, calm);

    // Motes of dust drifting over the island.
    const motes = 70;
    this.motePositions = new Float32Array(motes * 3);
    const moteGeometry = new SphereGeometry(1, 1, 1);
    moteGeometry.setAttribute('position', new Float32BufferAttribute(this.motePositions, 3));
    this.motes = new Points(moteGeometry, new PointsMaterial({ color: 0xc9b98f, size: 4, sizeAttenuation: false, transparent: true, opacity: 0.7, map: dotTexture(), depthWrite: false }));
    this.motes.frustumCulled = false;
    this.scene.add(this.motes);

    // The puffs carry their colours from the start, as the gatherers do, so they draw with a program
    // already linked; then every program links now, before play, not in the frame of the first unlock.
    this.puffProp.colour(0, scratchC.set(PALETTE.sand));
    this.renderer.compile(this.scene, this.camera);
  }

  setState(state: SimState): void {
    this.state = state;
  }

  /** Sizes the canvas to its host and keeps the island inside `safe`, the part of it no panel covers. */
  resize(width: number, height: number, safe: SafeArea): void {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.safe = safe;
    this.renderer.setSize(this.width, this.height, true);
    this.fit();
  }

  private fit(): void {
    const safeW = Math.max(80, this.width - this.safe.left - this.safe.right);
    const safeH = Math.max(80, this.height - this.safe.top - this.safe.bottom);
    const tall = Math.min(1, Math.max(0, (safeH / safeW - 0.7) / 0.4));
    this.direction = new Vector3(1, WIDE_LIFT + (TALL_LIFT - WIDE_LIFT) * tall, 1).normalize();
    const forward = this.direction.clone().negate();
    const right = new Vector3().crossVectors(forward, UP).normalize();
    const up = new Vector3().crossVectors(right, forward).normalize();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const x of [-FRAME_BOX.half, FRAME_BOX.half]) {
      for (const y of [FRAME_BOX.low, FRAME_BOX.high]) {
        for (const z of [-FRAME_BOX.half, FRAME_BOX.half]) {
          const p = new Vector3(x, y, z);
          minX = Math.min(minX, p.dot(right));
          maxX = Math.max(maxX, p.dot(right));
          minY = Math.min(minY, p.dot(up));
          maxY = Math.max(maxY, p.dot(up));
        }
      }
    }
    // Never so close that the island fills a huge screen edge to edge.
    const unitsPerPx = Math.max(((maxX - minX) * 0.97) / safeW, (maxY - minY) / safeH, (maxX - minX) / 1100) * 1.02;
    this.frame0 = {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      unitsPerPx,
      sx: this.safe.left + safeW / 2,
      sy: this.safe.top + safeH / 2,
    };
    // Lines a little thicker when the island is drawn big.
    const islandPx = (maxX - minX) / unitsPerPx;
    outlineUniform.value = Math.min(3.2, Math.max(2.0, islandPx / 200)) * unitsPerPx;
  }

  private placeCamera(): void {
    // The camera holds still unless the player caused a moment: no ambient sway or breathing (the game
    // quality bar, Camera), only the short punch an unlock or a big strike gives, off under reduced motion.
    const t = this.time;
    const punchK = Math.max(0, 1 - (t - this.punchAt) / 0.6);
    const punch = this.calm ? 0 : Math.sin(punchK * Math.PI) * 0.035 * punchK * this.punchPower;
    const zoom = 1 - punch;
    this.camera.position.copy(this.direction).multiplyScalar(CAMERA_DISTANCE);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    const f = this.frame0;
    const u = f.unitsPerPx * zoom;
    // The island's centre lands on the safe area's centre.
    const left = f.cx - f.sx * u;
    const top = f.cy + f.sy * u;
    this.camera.left = left;
    this.camera.right = left + this.width * u;
    this.camera.top = top;
    this.camera.bottom = top - this.height * u;
    this.camera.updateProjectionMatrix();
  }

  /** Where the top of the pile is on the canvas, in CSS pixels: the strike floaters rise from here. */
  pileScreen(): { x: number; y: number } {
    const p = new Vector3(0, this.pileShown * 1.0, 0).project(this.camera);
    return { x: ((p.x + 1) / 2) * this.width, y: ((1 - p.y) / 2) * this.height };
  }

  private random(): number {
    this.fxSeed += 1;
    return hash01(this.fxSeed * 2654435761);
  }

  strike(gain: number, streak: number): void {
    const starry = this.state?.weather?.kind === 'shooting-star';
    this.squashAt = this.time;
    this.squashPower = Math.min(1, 0.55 + streak * 0.05);
    if (this.calm || !(gain > 0)) return;
    const count = 7 + Math.min(10, streak);
    const top = this.pileShown;
    for (let i = 0; i < count; i += 1) {
      const a = this.random() * Math.PI * 2;
      const speed = 1.8 + this.random() * 2.4;
      this.spawn(this.chunks, CHUNKS, {
        born: this.time,
        life: 0.9 + this.random() * 0.5,
        p: new Vector3(Math.cos(a) * 0.3 * top, top * 0.85, Math.sin(a) * 0.3 * top),
        v: new Vector3(Math.cos(a) * speed, 3.2 + this.random() * 2.6, Math.sin(a) * speed),
        spin: (this.random() - 0.5) * 14,
        size: 0.06 + this.random() * 0.06,
        colour: starry ? (this.random() < 0.5 ? PALETTE.yellow : PALETTE.paper) : this.random() < 0.3 ? PALETTE.sandDeep : PALETTE.sand,
      });
    }
    // A strike that lands big (a long streak, or under a shooting star) nudges the camera too.
    if (streak >= 8 || starry) this.punch(0.35);
  }

  private punch(power: number): void {
    // A smaller nudge never cuts short a bigger one still playing.
    const left = Math.max(0, 1 - (this.time - this.punchAt) / 0.6) * this.punchPower;
    if (power < left) return;
    this.punchAt = this.time;
    this.punchPower = power;
  }

  /** A unit passed a milestone: a nudge and a puff of dust where it stands. */
  milestone(unit: string, owned: number): void {
    this.punch(0.6);
    if (this.calm) return;
    const index = Math.min(owned, UNIT_CAPS[unit] ?? 1) - 1;
    const where = this.unitPosition(unit, Math.max(0, index)) ?? new Vector3(0, 0, 0);
    this.burst(where.clone().setY(1.2), 26, 0.7);
  }

  /** The pile was pressed: the island's biggest moment. */
  pressed(): void {
    this.punch(1.6);
    this.squashAt = this.time;
    this.squashPower = 1;
    // Whatever the new season starts with pops in again.
    this.popAt.clear();
    for (const unit of Object.keys(UNIT_CAPS)) this.popAt.set(unit, Array.from({ length: UNIT_CAPS[unit]! }, (_, i) => this.time + 0.3 + i * 0.05));
    if (this.calm) return;
    this.burst(new Vector3(0, this.pileShown * 1.4, 0), 60, 1.5);
    this.ring(new Vector3(0, 0.06, 0), this.pileShown * 1.1, this.pileShown * 1.1 + 3.4, 0.8);
    for (let i = 0; i < 40; i += 1) {
      const a = this.random() * Math.PI * 2;
      const speed = 2 + this.random() * 4;
      this.spawn(this.chunks, CHUNKS, {
        born: this.time,
        life: 1.2 + this.random() * 0.6,
        p: new Vector3(Math.cos(a) * 0.4, this.pileShown, Math.sin(a) * 0.4),
        v: new Vector3(Math.cos(a) * speed, 5 + this.random() * 4, Math.sin(a) * speed),
        spin: (this.random() - 0.5) * 14,
        size: 0.08 + this.random() * 0.08,
        colour: [PALETTE.lavender, PALETTE.teal, PALETTE.pink, PALETTE.sand][i % 4]!,
      });
    }
  }

  /** A perk was bought: the gem ring glints. */
  perk(): void {
    this.punch(0.4);
    if (this.calm) return;
    const r = this.pileShown * 1.08 + 0.55;
    for (let i = 0; i < 24; i += 1) {
      const a = (i / 24) * Math.PI * 2;
      this.spawn(this.chunks, CHUNKS, {
        born: this.time + (i % 6) * 0.03,
        life: 0.8,
        p: new Vector3(Math.cos(a) * r, 0.4, Math.sin(a) * r),
        v: new Vector3(Math.cos(a) * 0.6, 3 + this.random() * 1.5, Math.sin(a) * 0.6),
        spin: 8,
        size: 0.07,
        colour: [PALETTE.yellow, PALETTE.paper, PALETTE.lavender][i % 3]!,
      });
    }
  }

  /** The weather turned: a small beat so the eye goes to it. */
  weatherTurned(): void {
    this.punch(0.3);
  }

  /** Where the dust devil is on the canvas, in CSS pixels, or null when there is none: a tap near it catches it. */
  devilScreen(): { x: number; y: number } | null {
    const at = this.depth.devilAt;
    if (at === null) return null;
    const p = at.clone().project(this.camera);
    return { x: ((p.x + 1) / 2) * this.width, y: ((1 - p.y) / 2) * this.height };
  }

  /** The dust devil was caught: the rare event's beat, a big nudge and its sand flung out in a ring. */
  caught(): void {
    this.punch(1.2);
    const at = this.depth.devilAt ?? new Vector3(0, 0.9, 0);
    if (this.calm) return;
    this.burst(at.clone().setY(1.4), 40, 0.9);
    this.ring(at.clone().setY(0.06), 0.5, 2.2, 0.6);
    for (let i = 0; i < 36; i += 1) {
      const a = (i / 36) * Math.PI * 2;
      const speed = 2.5 + this.random() * 2;
      this.spawn(this.chunks, CHUNKS, {
        born: this.time + (i % 4) * 0.02,
        life: 1.1,
        p: new Vector3(at.x + Math.cos(a) * 0.4, 0.3 + (i % 6) * 0.25, at.z + Math.sin(a) * 0.4),
        v: new Vector3(Math.cos(a) * speed, 2.5 + this.random() * 2, Math.sin(a) * speed),
        spin: 12,
        size: 0.07 + this.random() * 0.05,
        colour: i % 3 === 0 ? PALETTE.yellow : PALETTE.sand,
      });
    }
  }

  /** An order was filled: a nudge and a puff of dust from the pile's foot, where the crate stood. */
  filled(): void {
    this.punch(0.45);
    if (this.calm) return;
    const r = this.pileShown * 1.05 + 0.45;
    this.puff(new Vector3(r * 0.7071, 0.3, r * 0.7071));
    this.burst(new Vector3(r * 0.7071, 0.8, r * 0.7071), 18, 0.5);
  }

  /** A fork was chosen: a nudge and a puff of dust at the signpost, where the new plank goes up. */
  chose(): void {
    this.punch(0.6);
    if (this.calm) return;
    this.burst(new Vector3(SIGNPOST.x, 1.6, SIGNPOST.z), 30, 0.7);
    this.ring(new Vector3(SIGNPOST.x, 0.06, SIGNPOST.z), 0.3, 1.5, 0.5);
  }

  // A cloud of dust puffs thrown up and out from `at`: the pile's own sand, a deeper sand and paper,
  // never a rainbow. They hang a moment, drift down and shrink away.
  private burst(at: Vector3, count: number, scale: number): void {
    for (let i = 0; i < count; i += 1) {
      const a = this.random() * Math.PI * 2;
      const speed = (1.4 + this.random() * 3) * Math.sqrt(scale);
      this.spawn(this.puffs, PUFFS, {
        born: this.time + (i % 5) * 0.025,
        life: 1.3 + this.random() * 0.9,
        p: at.clone().add(new Vector3(Math.cos(a) * 0.25, 0, Math.sin(a) * 0.25)),
        v: new Vector3(Math.cos(a) * speed, (2.5 + this.random() * 3.5) * Math.sqrt(scale), Math.sin(a) * speed),
        spin: (this.random() - 0.5) * 3,
        size: (0.13 + this.random() * 0.17) * Math.sqrt(scale),
        colour: i % 5 === 0 ? PALETTE.paper : i % 3 === 0 ? PALETTE.sandDeep : PALETTE.sand,
      });
    }
  }

  // An ink ring that runs out across the ground from `at`, from radius `from` to `to`, and thins away.
  private ring(at: Vector3, from: number, to: number, life: number): void {
    if (this.rings.length >= RINGS) this.rings.shift();
    this.rings.push({ born: this.time, life, at, from, to });
  }

  bought(unit: string, owned: number): void {
    const index = owned - 1;
    if (index < (UNIT_CAPS[unit] ?? 0)) {
      const pops = this.popAt.get(unit) ?? [];
      pops[index] = this.time;
      this.popAt.set(unit, pops);
      const where = this.unitPosition(unit, index);
      if (where !== null && !this.calm) this.puff(where);
    } else {
      this.bumpAt.set(unit, this.time);
    }
    this.punch(0.25);
  }

  /** An unlock: the pile blows a cloud of its own dust into the air, and an ink ring runs out from its foot. */
  unlocked(): void {
    this.punch(1);
    if (this.calm) return;
    this.burst(new Vector3(0, this.pileShown * 1.2, 0), 54, 1.3);
    this.ring(new Vector3(0, 0.06, 0), this.pileShown * 1.05, this.pileShown * 1.05 + 2.8, 0.65);
  }

  /** The welcome-back moment: dust rains into the pile. */
  welcome(): void {
    this.punch(1);
    if (this.calm) return;
    for (let i = 0; i < 50; i += 1) {
      const a = this.random() * Math.PI * 2;
      const r = this.random() * 1.6;
      this.spawn(this.chunks, CHUNKS, {
        born: this.time + this.random() * 1.2,
        life: 1.6,
        p: new Vector3(Math.cos(a) * r, 7 + this.random() * 4, Math.sin(a) * r),
        v: new Vector3(0, -2, 0),
        spin: (this.random() - 0.5) * 10,
        size: 0.07 + this.random() * 0.07,
        colour: this.random() < 0.3 ? PALETTE.sandDeep : PALETTE.sand,
      });
    }
  }

  private puff(at: Vector3): void {
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      this.spawn(this.chunks, CHUNKS, {
        born: this.time,
        life: 0.6,
        p: at.clone().add(new Vector3(Math.cos(a) * 0.3, 0.1, Math.sin(a) * 0.3)),
        v: new Vector3(Math.cos(a) * 2.2, 1.6, Math.sin(a) * 2.2),
        spin: 6,
        size: 0.07,
        colour: PALETTE.paper,
      });
    }
  }

  private spawn(pool: Chunk[], cap: number, chunk: Chunk): void {
    if (pool.length >= cap) pool.shift();
    pool.push(chunk);
  }

  private unitPosition(unit: string, index: number): Vector3 | null {
    const slots = STRUCTURE_SLOTS[unit];
    if (slots !== undefined) {
      const slot = slots[index];
      return slot === undefined ? null : new Vector3(slot.x, 0, slot.z);
    }
    if (unit === 'cart') {
      const a = (CART_ORDER[index % CART_ORDER.length]! / CART_ORDER.length) * Math.PI * 2 - this.time * 0.35;
      return new Vector3(Math.cos(a) * TRACK_RADIUS, 0, Math.sin(a) * TRACK_RADIUS);
    }
    if (unit === 'gatherer') {
      const path = gathererPath(index);
      const r = this.pileShown + 0.3 + (path.reach - this.pileShown) * 0.5;
      return new Vector3(Math.cos(path.angle) * r, 0, Math.sin(path.angle) * r);
    }
    return null;
  }

  // 0 to 1 while a unit pops in, 1 after; a bump wobbles a unit when one is bought past the cap.
  private popScale(unit: string, index: number): number {
    const at = this.popAt.get(unit)?.[index];
    let s = 1;
    if (at !== undefined && !this.calm) s = easeOutBack(Math.min(1, Math.max(0, (this.time - at) / POP_SECONDS)));
    const bump = this.bumpAt.get(unit);
    if (bump !== undefined && !this.calm) {
      const k = (this.time - bump) / 0.35;
      if (k >= 0 && k < 1) s *= 1 + Math.sin(k * Math.PI) * 0.15 * (index % 2 === 0 ? 1 : 0.6);
    }
    return s;
  }

  /** Advances every animation to `ms` (the frame clock, in milliseconds) and draws. */
  frame(ms: number): void {
    this.time = ms / 1000;
    const dt = this.lastTime === null ? 0 : Math.min(0.05, Math.max(0, this.time - this.lastTime));
    this.lastTime = this.time;
    this.update(dt);
    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
  }

  private update(dt: number): void {
    const state = this.state;
    if (state === null) return;
    const t = this.calm ? 0 : this.time;
    this.depth.begin();
    let shadows = 0;
    const shadow = (x: number, z: number, r: number): void => {
      if (shadows >= this.shadows.capacity || r <= 0.01) return;
      this.shadows.set(shadows, compose(x, 0, z, 0, r * 2, 1, r * 2 * 0.9));
      shadows += 1;
    };

    // The pile eases toward its size for the lifetime total, and squashes on a strike.
    const target = pileScale(state.totalDust);
    this.pileShown = this.pileShown === 0 || this.calm ? target : this.pileShown + (target - this.pileShown) * Math.min(1, dt * 3);
    const k = (this.time - this.squashAt) / 0.42;
    let squash = 0;
    if (k >= 0 && k < 1 && !this.calm) squash = Math.sin(k * Math.PI * 2.2) * (1 - k) * 0.22 * this.squashPower;
    const s = this.pileShown;
    this.pile.scale.set(s * (1 + squash * 0.55), s * (1 - squash), s * (1 + squash * 0.55));
    this.flag.rotation.y = this.calm ? 0.4 : 0.4 + Math.sin(t * 2.1) * 0.25;
    shadow(0, 0, s * 1.15);

    // Plots: a staked square for each building not yet built, so the island shows what is to come.
    let plots = 0;
    for (const unit of ['mill', 'forge', 'foundry']) {
      if (ownedCount(state, unit) > 0) continue;
      const slot = STRUCTURE_SLOTS[unit]![0]!;
      this.plots.set(plots, compose(slot.x, 0, slot.z, slot.rot, 1));
      plots += 1;
    }
    this.plots.commit(plots);

    // Gatherers walk out along their lanes and back with a sack.
    const gatherers = shownCount('gatherer', ownedCount(state, 'gatherer'));
    let sacks = 0;
    for (let i = 0; i < gatherers; i += 1) {
      const path = gathererPath(i);
      const { along, inbound } = this.calm ? { along: 0.45, inbound: true } : gathererPhase(path, t);
      const near = s * 1.02 + 0.25;
      const r = near + (path.reach - near) * along;
      const x = Math.cos(path.angle) * r;
      const z = Math.sin(path.angle) * r;
      const walking = !this.calm && along > 0.001 && along < 0.999;
      const bob = walking ? Math.abs(Math.sin(t * 9 + i)) * 0.07 : 0;
      // Facing: +z of the model is its face. Outbound faces away from the pile.
      const heading = Math.atan2(Math.cos(path.angle), Math.sin(path.angle)) + (inbound ? Math.PI : 0);
      const pop = this.popScale('gatherer', i);
      const tilt = walking ? Math.sin(t * 9 + i) * 0.08 : 0;
      this.gatherers.set(i, compose(x, bob, z, heading, pop, pop, pop, 0, tilt));
      this.depth.hat(state, x, bob, z, heading, pop, tilt);
      shadow(x, z, 0.3 * pop);
      if (inbound && pop > 0.01) {
        const back = -0.2;
        this.sacks.set(sacks, compose(x + Math.sin(heading) * back, 0.42 + bob, z + Math.cos(heading) * back, heading, pop));
        sacks += 1;
      }
    }
    this.gatherers.commit(gatherers);
    this.sacks.commit(sacks);

    // Carts roll around the track.
    const carts = shownCount('cart', ownedCount(state, 'cart'));
    this.track.visible = carts > 0 || state.unlocked.some((event) => event.id === 'cart');
    for (let i = 0; i < carts; i += 1) {
      const a = (CART_ORDER[i % CART_ORDER.length]! / CART_ORDER.length) * Math.PI * 2 - t * 0.35;
      const x = Math.cos(a) * TRACK_RADIUS;
      const z = Math.sin(a) * TRACK_RADIUS;
      const pop = this.popScale('cart', i);
      const rattle = this.calm ? 0 : Math.abs(Math.sin(t * 14 + i * 2)) * 0.025;
      this.carts.set(i, compose(x, rattle, z, a, pop));
      this.depth.pennant(state, 'cart', new Vector3(x - Math.sin(a) * 0.25, 0.45 + rattle, z - Math.cos(a) * 0.25), -a, pop, t);
      shadow(x, z, 0.45 * pop);
    }
    this.carts.commit(carts);

    // Mills turn their sails.
    const mills = shownCount('mill', ownedCount(state, 'mill'));
    for (let i = 0; i < mills; i += 1) {
      const slot = STRUCTURE_SLOTS['mill']![i]!;
      const pop = this.popScale('mill', i);
      this.mills.set(i, compose(slot.x, 0, slot.z, slot.rot, pop));
      const hub = this.local(slot, 0, 1.3, 0.7, pop);
      this.sails.set(i, compose(hub.x, hub.y, hub.z, slot.rot, pop, pop, pop, 0, t * 1.4 + i));
      this.depth.pennant(state, 'mill', this.local(slot, 0, 1.92, 0, pop), slot.rot, pop, t);
      shadow(slot.x, slot.z, 0.75 * pop);
    }
    this.mills.commit(mills);
    this.sails.commit(mills);

    // Forges glow and spit sparks.
    const forges = shownCount('forge', ownedCount(state, 'forge'));
    const glow = this.calm ? 0.5 : 0.5 + 0.5 * Math.sin(t * 3.1) * Math.sin(t * 1.7 + 0.4);
    this.glowMaterial.color.set(PALETTE.orange).lerp(scratchC.set(PALETTE.yellow), glow);
    let sparks = 0;
    for (let i = 0; i < forges; i += 1) {
      const slot = STRUCTURE_SLOTS['forge']![i]!;
      const pop = this.popScale('forge', i);
      this.forges.set(i, compose(slot.x, 0, slot.z, slot.rot, pop));
      this.glows.set(i, compose(slot.x, 0, slot.z, slot.rot, pop));
      this.depth.pennant(state, 'forge', this.local(slot, 0.05, 1.16, 0.05, pop), slot.rot, pop, t);
      shadow(slot.x, slot.z, 0.8 * pop);
      if (this.calm) continue;
      for (let j = 0; j < 6; j += 1) {
        const phase = (t * 1.3 + j / 6 + i * 0.37) % 1;
        const a = hash01(Math.floor(t * 1.3 + j / 6 + i * 0.37) * 31 + j * 7 + i) * Math.PI - Math.PI / 2;
        const base = this.local(slot, 0.08 + Math.sin(a) * 0.15 * phase * 3, 0.32 + phase * 1.2 - phase * phase * 1.4, 0.95 + phase * 0.5, pop);
        const sz = (1 - phase) * pop;
        this.sparks.set(sparks, compose(base.x, base.y, base.z, phase * 9, sz));
        sparks += 1;
      }
    }
    this.forges.commit(forges);
    this.glows.commit(forges);
    this.sparks.commit(sparks);

    // Foundries puff smoke from both chimneys.
    const foundries = shownCount('foundry', ownedCount(state, 'foundry'));
    let puffs = 0;
    for (let i = 0; i < foundries; i += 1) {
      const slot = STRUCTURE_SLOTS['foundry']![i]!;
      const pop = this.popScale('foundry', i);
      this.foundries.set(i, compose(slot.x, 0, slot.z, slot.rot, pop));
      this.depth.pennant(state, 'foundry', this.local(slot, 0.0, 1.42, 0.3, pop), slot.rot, pop, t);
      shadow(slot.x, slot.z, 1.05 * pop);
      for (let c = 0; c < 2; c += 1) {
        for (let j = 0; j < 3; j += 1) {
          const phase = this.calm ? 0.25 + j * 0.25 : (t * 0.45 + j / 3 + c * 0.17 + i * 0.29) % 1;
          const p = this.local(slot, c === 0 ? -0.5 : 0.45, 2.4 + phase * 1.7, -0.38, pop);
          const size = Math.sin(Math.min(1, phase * 1.1) * Math.PI) * (0.35 + phase * 0.75) * pop;
          // Smoke leans away from the camera and wobbles as it rises.
          const lean = phase * 1.1 + Math.sin(t * 1.3 + j * 2 + c) * 0.12 * phase;
          this.smoke.set(puffs, compose(p.x - lean, p.y, p.z - lean * 0.6, phase * 2 + j, size, size * 0.85, size));
          puffs += 1;
        }
      }
    }
    this.foundries.commit(foundries);
    this.smoke.commit(puffs);

    // The later layers: milestone badges, gems, season flowers and the weather; a shooting star
    // trails sparkles into the particle pool.
    for (const sparkle of this.depth.update(state, this.time, dt, s)) {
      this.spawn(this.chunks, CHUNKS, {
        born: this.time,
        life: 0.7,
        p: sparkle.at.clone(),
        v: new Vector3((this.random() - 0.5) * 0.8, -0.5 - this.random(), (this.random() - 0.5) * 0.8),
        spin: 10,
        size: 0.05 + this.random() * 0.04,
        colour: sparkle.colour,
      });
    }

    // Strike dust, purchase puffs and the welcome-back rain.
    this.chunks.splice(0, this.chunks.length, ...this.chunks.filter((c) => this.time - c.born < c.life));
    let drawn = 0;
    for (const c of this.chunks) {
      const age = this.time - c.born;
      if (age < 0) continue;
      c.v.y -= 11 * dt;
      c.p.addScaledVector(c.v, dt);
      if (c.p.y < 0.05) {
        c.p.y = 0.05;
        c.v.multiplyScalar(0.4);
        c.v.y = Math.abs(c.v.y) * 0.3;
      }
      const fade = Math.min(1, (c.life - age) / 0.25);
      this.chunkProp.set(drawn, compose(c.p.x, c.p.y, c.p.z, age * c.spin, c.size * fade));
      this.chunkProp.colour(drawn, scratchC.set(c.colour));
      drawn += 1;
    }
    this.chunkProp.commit(drawn);

    // The big moments' dust puffs: thrown out fast, held back by the air, drifting down as they shrink.
    this.puffs.splice(0, this.puffs.length, ...this.puffs.filter((c) => this.time - c.born < c.life));
    drawn = 0;
    for (const c of this.puffs) {
      const age = this.time - c.born;
      if (age < 0) continue;
      c.v.y -= 2.4 * dt;
      c.v.multiplyScalar(1 - Math.min(1, dt * 2.8));
      c.p.addScaledVector(c.v, dt);
      if (c.p.y < c.size) {
        c.p.y = c.size;
        c.v.y = 0;
      }
      const k = age / c.life;
      const grow = 1 - (1 - Math.min(1, age / 0.14)) ** 2;
      const size = c.size * grow * (1 - k * k);
      this.puffProp.set(drawn, compose(c.p.x, c.p.y, c.p.z, age * c.spin, size, size * 0.86, size));
      this.puffProp.colour(drawn, scratchC.set(c.colour));
      drawn += 1;
    }
    this.puffProp.commit(drawn);

    // The ink rings: dashes of ink line round a circle that runs out fast, then thins away. The line is
    // as thick as the outlines (render/toon.ts), however big the island is drawn.
    this.rings.splice(0, this.rings.length, ...this.rings.filter((r) => this.time - r.born < r.life));
    drawn = 0;
    const line = outlineUniform.value * 1.1;
    for (const r of this.rings) {
      const k = (this.time - r.born) / r.life;
      const radius = r.from + (r.to - r.from) * (1 - (1 - k) ** 3);
      const thick = line * Math.sqrt(1 - k);
      const dash = ((Math.PI * 2 * radius) / RING_DASHES) * 0.62;
      for (let i = 0; i < RING_DASHES; i += 1) {
        const a = (i / RING_DASHES) * Math.PI * 2 + r.from;
        this.ringProp.set(drawn, compose(r.at.x + Math.cos(a) * radius, r.at.y, r.at.z + Math.sin(a) * radius, -a - Math.PI / 2, dash, thick, thick));
        drawn += 1;
      }
    }
    this.ringProp.commit(drawn);

    this.shadows.commit(shadows);

    // Motes drift on slow loops above the island, faster in a breeze.
    const tw = this.calm ? 0 : this.depth.windTime;
    const motes = this.motePositions.length / 3;
    for (let i = 0; i < motes; i += 1) {
      const bx = (hash01(i * 3 + 1) - 0.5) * ISLAND_HALF * 2.1;
      const bz = (hash01(i * 3 + 2) - 0.5) * ISLAND_HALF * 2.1;
      const by = 0.3 + hash01(i * 3 + 3) * 3.2;
      const w = 0.2 + hash01(i + 900) * 0.3;
      this.motePositions[i * 3] = bx + Math.sin(tw * w + i) * 0.6;
      this.motePositions[i * 3 + 1] = by + Math.sin(tw * w * 1.3 + i * 2) * 0.35;
      this.motePositions[i * 3 + 2] = bz + Math.cos(tw * w * 0.9 + i) * 0.6;
    }
    this.motes.geometry.attributes['position']!.needsUpdate = true;
  }

  // A point in a building's own frame (x right, y up, z its front), in world space.
  private local(slot: Slot, x: number, y: number, z: number, scale: number): Vector3 {
    const c = Math.cos(slot.rot);
    const s = Math.sin(slot.rot);
    return new Vector3(slot.x + (x * c + z * s) * scale, y * scale, slot.z + (-x * s + z * c) * scale);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
