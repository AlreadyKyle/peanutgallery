// The studio's line style in Three.js: flat toon fills with one shade step, and thick ink outlines
// drawn as an inverted hull pushed out along smoothed normals in view space, so every line is the
// same 2 to 3 CSS pixels whatever an object's scale. Geometry is built from coloured parts merged
// into one mesh per prop, so a building is one draw call and its outline another.
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  InstancedMesh,
  Matrix4,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  ShaderMaterial,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const INK = 0x151515;

/** The outline's width in world units, shared by every outline material; render/scene.ts sets it on resize. */
export const outlineUniform = { value: 0.05 };

// Two tones: lit and one shade. The ambient light keeps the shade light, as a flat fill with a
// darker side reads in the line style.
function gradientMap(): DataTexture {
  const texture = new DataTexture(new Uint8Array([110, 255]), 2, 1, RedFormat);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

let sharedGradient: DataTexture | null = null;

export function toonMaterial(options: { vertexColors?: boolean; color?: number } = {}): MeshToonMaterial {
  sharedGradient ??= gradientMap();
  return new MeshToonMaterial({
    color: options.color ?? 0xffffff,
    vertexColors: options.vertexColors ?? true,
    gradientMap: sharedGradient,
  });
}

let sharedOutline: ShaderMaterial | null = null;

export function outlineMaterial(): ShaderMaterial {
  const ink = new Color(INK);
  sharedOutline ??= new ShaderMaterial({
    uniforms: { outlineWidth: outlineUniform, inkColour: { value: [ink.r, ink.g, ink.b] } },
    side: BackSide,
    vertexShader: /* glsl */ `
      attribute vec3 smoothNormal;
      uniform float outlineWidth;
      void main() {
        vec4 local = vec4(position, 1.0);
        vec3 n = smoothNormal;
        #ifdef USE_INSTANCING
          local = instanceMatrix * local;
          n = mat3(instanceMatrix) * n;
        #endif
        vec4 mv = modelViewMatrix * local;
        vec3 vn = normalize(normalMatrix * n);
        mv.xyz += vn * outlineWidth;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 inkColour;
      void main() {
        gl_FragColor = vec4(inkColour, 1.0);
      }
    `,
  });
  return sharedOutline;
}

/** A part of a prop: a geometry, its fill and where it sits in the prop. */
export function part(geometry: BufferGeometry, colour: number, matrix?: Matrix4): BufferGeometry {
  const flat = geometry.index === null ? geometry : geometry.toNonIndexed();
  if (matrix !== undefined) flat.applyMatrix4(matrix);
  for (const name of Object.keys(flat.attributes)) {
    if (name !== 'position' && name !== 'normal') flat.deleteAttribute(name);
  }
  const c = new Color(colour);
  const count = flat.attributes['position']!.count;
  const colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colours[i * 3] = c.r;
    colours[i * 3 + 1] = c.g;
    colours[i * 3 + 2] = c.b;
  }
  flat.setAttribute('color', new BufferAttribute(colours, 3));
  return flat;
}

/** Merges parts into one geometry and adds the smoothed normals its outline is pushed along. */
export function merge(parts: BufferGeometry[]): BufferGeometry {
  const merged = parts.length === 1 ? parts[0]! : mergeGeometries(parts, false);
  if (merged === null) throw new Error('could not merge the parts of a prop');
  addSmoothNormals(merged);
  return merged;
}

// Faces that meet at a corner have different normals, and pushing each along its own leaves gaps in
// the outline; the average of every normal at one position closes them.
export function addSmoothNormals(geometry: BufferGeometry): void {
  const position = geometry.attributes['position']!;
  const normal = geometry.attributes['normal']!;
  const sums = new Map<string, [number, number, number]>();
  const key = (i: number): string =>
    `${Math.round(position.getX(i) * 1000)},${Math.round(position.getY(i) * 1000)},${Math.round(position.getZ(i) * 1000)}`;
  for (let i = 0; i < position.count; i += 1) {
    const k = key(i);
    const sum = sums.get(k) ?? [0, 0, 0];
    sum[0] += normal.getX(i);
    sum[1] += normal.getY(i);
    sum[2] += normal.getZ(i);
    sums.set(k, sum);
  }
  const out = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) {
    const [x, y, z] = sums.get(key(i))!;
    const length = Math.hypot(x, y, z);
    // A thin plate's two faces cancel out; it keeps its own normal.
    const use = length > 1e-3 ? [x / length, y / length, z / length] : [normal.getX(i), normal.getY(i), normal.getZ(i)];
    out[i * 3] = use[0]!;
    out[i * 3 + 1] = use[1]!;
    out[i * 3 + 2] = use[2]!;
  }
  geometry.setAttribute('smoothNormal', new BufferAttribute(out, 3));
}

/** An instanced prop and, unless `outlined` is false, its instanced ink hull sharing the same matrices. */
export class Prop {
  readonly mesh: InstancedMesh;
  readonly outline: InstancedMesh | null;

  constructor(geometry: BufferGeometry, capacity: number, material: Material = toonMaterial(), outlined = true) {
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    if (outlined) {
      if (geometry.getAttribute('smoothNormal') === undefined) addSmoothNormals(geometry);
      this.outline = new InstancedMesh(geometry, outlineMaterial(), capacity);
      this.outline.instanceMatrix = this.mesh.instanceMatrix;
      this.outline.frustumCulled = false;
      this.outline.count = 0;
    } else {
      this.outline = null;
    }
  }

  get capacity(): number {
    return this.mesh.instanceMatrix.count;
  }

  set(index: number, matrix: Matrix4): void {
    this.mesh.setMatrixAt(index, matrix);
  }

  colour(index: number, colour: Color): void {
    this.mesh.setColorAt(index, colour);
    if (this.mesh.instanceColor !== null) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Draws the first `count` instances; call after setting their matrices this frame. */
  commit(count: number): void {
    const n = Math.max(0, Math.min(this.capacity, count));
    this.mesh.count = n;
    if (this.outline !== null) this.outline.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
