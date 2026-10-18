import { useId, type CSSProperties, type ReactNode } from 'react';

/**
 * Agent avatars, drawn by code (the art policy: art in the games and the agent avatars is drawn by
 * code). One component draws every agent from its one-line species note, so the same note always
 * gives the same picture and a new note gives a new one without anyone drawing it. Colours come from
 * the --creature-* tokens in styles.css; outlines are --ink, so each shape reads on --paper.
 */

export const CREATURE_COLOURS = [
  'blue',
  'lavender',
  'green',
  'pink',
  'orange',
  'yellow',
  'purple',
  'grey',
  'teal',
  'red',
  'brown',
] as const;
export type CreatureColour = (typeof CREATURE_COLOURS)[number];

export type Build = 'round' | 'small' | 'slim' | 'squat' | 'short' | 'soft';
export type EyeShape = 'normal' | 'small' | 'large' | 'wide' | 'tall';

export type AvatarFeatures = {
  colour: CreatureColour;
  build: Build;
  eyes: { count: number; shape: EyeShape; ring: boolean };
  antennae: boolean;
  horns: boolean;
  ears: boolean;
  arms: number;
  fingers: boolean;
  tail: boolean;
  shell: boolean;
  tuft: boolean;
  legs: 'none' | 'stubby' | 'long';
  wideMouth: boolean;
  wideHead: boolean;
};

const BUILDS: readonly Build[] = ['round', 'small', 'slim', 'squat', 'short', 'soft'];
const NUMBERS: Record<string, number> = {
  one: 1,
  single: 1,
  a: 1,
  two: 2,
  pair: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
};

/** A small stable hash (FNV-1a), used only to fill in what a note does not say. */
export function noteHash(note: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < note.length; i += 1) {
    hash ^= note.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function countBefore(text: string, noun: RegExp): number | null {
  // "six small eyes", "two tall, narrow eyes", "a pair of wide eyes", "one large eye", "four thin arms".
  const match = text.match(new RegExp(`\\b(one|single|two|three|four|five|six|seven|eight|pair)\\b(?:\\s+of)?(?:\\s+[a-z]+,?){0,2}\\s+${noun.source}`));
  return match === null ? null : (NUMBERS[match[1]!] ?? null);
}

/** Reads the drawable features out of a species note. Pure: the same note always gives the same features. */
export function avatarFeatures(note: string): AvatarFeatures {
  const text = note.toLowerCase().replace(/\bgray\b/g, 'grey');
  const hash = noteHash(text);
  // "A small blue creature with...": the words before "creature" say its build and colour; the rest
  // says its parts. Only when the lead names no colour is the whole note searched.
  const lead = text.split(/\bcreature\b/)[0] ?? text;
  const colourIn = (part: string) => CREATURE_COLOURS.find((colour) => new RegExp(`\\b${colour}\\b`).test(part));
  const colour = colourIn(lead) ?? colourIn(text) ?? CREATURE_COLOURS[hash % CREATURE_COLOURS.length]!;

  let build: Build = BUILDS[(hash >>> 4) % BUILDS.length]!;
  if (/\bround\b/.test(lead)) build = 'round';
  else if (/\bsquat\b/.test(lead)) build = 'squat';
  else if (/\b(thin|slim)\b/.test(lead)) build = 'slim';
  else if (/\bshort\b/.test(lead)) build = 'short';
  else if (/\bsoft\b/.test(lead)) build = 'soft';
  else if (/\bsmall\b/.test(lead)) build = 'small';

  const eyeCount = countBefore(text, /eyes?\b/) ?? 2;
  let shape: EyeShape = 'normal';
  if (/\blarge eye/.test(text)) shape = 'large';
  else if (/\bsmall eyes?\b/.test(text)) shape = 'small';
  else if (/\bwide eyes?\b/.test(text)) shape = 'wide';
  else if (/\b(tall|narrow)\b[^.]*\beyes?\b/.test(text)) shape = 'tall';

  const fingers = /\bfingers?\b/.test(text);
  const arms = countBefore(text, /arms?\b/) ?? (fingers || /\barms?\b/.test(text) ? 2 : 0);

  return {
    colour,
    build,
    eyes: { count: Math.max(1, Math.min(eyeCount, 8)), shape, ring: /\bring\b/.test(text) },
    antennae: /\bantenn/.test(text),
    horns: /\bhorns?\b/.test(text),
    ears: /\bears?\b/.test(text),
    arms: Math.min(arms, 6),
    fingers,
    tail: /\btail\b/.test(text),
    shell: /\bshell\b/.test(text),
    tuft: /\b(tuft|hair)\b/.test(text),
    legs: /\blong legs\b/.test(text) ? 'long' : /\blegs?\b/.test(text) ? 'stubby' : 'none',
    wideMouth: /\bwide mouth\b/.test(text),
    wideHead: /\b(wide head|broad face|flat, wide)\b/.test(text),
  };
}

type Body = { cx: number; cy: number; rx: number; ry: number };

function bodyFor(features: AvatarFeatures): Body {
  const shapes: Record<Build, Body> = {
    round: { cx: 60, cy: 68, rx: 33, ry: 33 },
    small: { cx: 60, cy: 74, rx: 27, ry: 28 },
    slim: { cx: 60, cy: 66, rx: 21, ry: 36 },
    squat: { cx: 60, cy: 80, rx: 38, ry: 24 },
    short: { cx: 60, cy: 76, rx: 29, ry: 26 },
    soft: { cx: 60, cy: 70, rx: 32, ry: 32 },
  };
  const body = shapes[features.build];
  return features.wideHead ? { ...body, rx: body.rx + 6 } : body;
}

function eyeAt(key: string, x: number, y: number, shape: EyeShape, asleep = false): ReactNode {
  const sizes: Record<EyeShape, { rx: number; ry: number; pupil: number }> = {
    normal: { rx: 6, ry: 6, pupil: 3 },
    small: { rx: 3.6, ry: 3.6, pupil: 1.8 },
    large: { rx: 11, ry: 11, pupil: 5 },
    wide: { rx: 8, ry: 6, pupil: 3.2 },
    tall: { rx: 4.2, ry: 8, pupil: 2.2 },
  };
  const size = sizes[shape];
  if (asleep) {
    // Eyes closed: a lid line curving down, the width of the open eye.
    return <path key={key} className="avatar-line avatar-thin avatar-lid" d={`M ${x - size.rx} ${y} Q ${x} ${y + size.ry} ${x + size.rx} ${y}`} />;
  }
  return (
    <g key={key}>
      <ellipse className="avatar-eye" cx={x} cy={y} rx={size.rx} ry={size.ry} />
      <circle className="avatar-pupil" cx={x} cy={y + size.ry * 0.2} r={size.pupil} />
    </g>
  );
}

function eyes(features: AvatarFeatures, body: Body, y: number, asleep: boolean): ReactNode[] {
  const { count, shape, ring } = features.eyes;
  if (ring && count > 2) {
    const radius = 11;
    return Array.from({ length: count }, (_, i) => {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2;
      return eyeAt(`eye-${i}`, body.cx + radius * Math.cos(angle), y + radius * Math.sin(angle), shape, asleep);
    });
  }
  const gap = shape === 'large' ? 24 : shape === 'wide' ? 20 : 15;
  const start = body.cx - (gap * (count - 1)) / 2;
  return Array.from({ length: count }, (_, i) => eyeAt(`eye-${i}`, start + gap * i, y, shape, asleep));
}

/** Everything drawn behind the body: ears, the tail and the legs. */
function behind(features: AvatarFeatures, body: Body): ReactNode[] {
  const parts: ReactNode[] = [];
  const top = body.cy - body.ry;
  const bottom = body.cy + body.ry;
  if (features.ears) {
    parts.push(
      <ellipse key="ear-l" className="avatar-body" cx={body.cx - body.rx * 0.78} cy={top + 10} rx={9} ry={16} transform={`rotate(-28 ${body.cx - body.rx * 0.78} ${top + 10})`} />,
      <ellipse key="ear-r" className="avatar-body" cx={body.cx + body.rx * 0.78} cy={top + 10} rx={9} ry={16} transform={`rotate(28 ${body.cx + body.rx * 0.78} ${top + 10})`} />,
    );
  }
  if (features.tail) {
    const x = body.cx + body.rx * 0.8;
    const y = body.cy + body.ry * 0.55;
    parts.push(<path key="tail" className="avatar-line avatar-thick" d={`M ${x} ${y} q 22 6 24 -14 q 1 -9 -7 -11`} />);
  }
  if (features.legs === 'stubby') {
    parts.push(
      <rect key="leg-l" className="avatar-body" x={body.cx - 16} y={bottom - 8} width={10} height={16} rx={4} />,
      <rect key="leg-r" className="avatar-body" x={body.cx + 6} y={bottom - 8} width={10} height={16} rx={4} />,
    );
  } else if (features.legs === 'long') {
    parts.push(
      <path key="leg-l" className="avatar-line" d={`M ${body.cx - 9} ${bottom - 4} L ${body.cx - 13} 112`} />,
      <path key="leg-r" className="avatar-line" d={`M ${body.cx + 9} ${bottom - 4} L ${body.cx + 13} 112`} />,
    );
  }
  return parts;
}

/** Arms and hands at the sides. */
function arms(features: AvatarFeatures, body: Body): ReactNode[] {
  const parts: ReactNode[] = [];
  const pairs = Math.ceil(features.arms / 2);
  for (let i = 0; i < features.arms; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    const row = Math.floor(i / 2);
    const y = body.cy + (row - (pairs - 1) / 2) * 11;
    const x0 = body.cx + side * body.rx * 0.92;
    const x1 = x0 + side * 15;
    const y1 = y + 9 - row * 3;
    parts.push(<path key={`arm-${i}`} className="avatar-line" d={`M ${x0} ${y} L ${x1} ${y1}`} />);
    if (features.fingers) {
      for (const [dx, dy] of [
        [4, -4],
        [5, 1],
        [3, 5],
      ] as const) {
        parts.push(<path key={`finger-${i}-${dx}-${dy}`} className="avatar-line avatar-thin" d={`M ${x1} ${y1} l ${side * dx} ${dy}`} />);
      }
    }
  }
  return parts;
}

/** Antennae, horns, a tuft of hair and a shell, drawn over the body. */
function onTop(features: AvatarFeatures, body: Body): ReactNode[] {
  const parts: ReactNode[] = [];
  const top = body.cy - body.ry;
  if (features.shell) {
    const left = body.cx - body.rx - 2;
    const right = body.cx + body.rx + 2;
    const base = body.cy - 2;
    parts.push(
      <path key="shell" className="avatar-body avatar-shell" d={`M ${left} ${base} A ${body.rx + 2} ${body.ry * 1.25} 0 0 1 ${right} ${base} Z`} />,
      <path key="shell-line" className="avatar-line avatar-thin" d={`M ${body.cx - body.rx * 0.5} ${base} Q ${body.cx} ${base - body.ry * 1.1} ${body.cx + body.rx * 0.5} ${base}`} />,
    );
  }
  const crown = features.shell ? body.cy - 2 - body.ry * 1.25 : top;
  if (features.antennae) {
    for (const side of [-1, 1]) {
      parts.push(
        <path key={`antenna-${side}`} className="avatar-line" d={`M ${body.cx + side * 9} ${crown + 4} L ${body.cx + side * 17} ${crown - 16}`} />,
        <circle key={`antenna-tip-${side}`} className="avatar-body" cx={body.cx + side * 17} cy={crown - 18} r={4.5} />,
      );
    }
  }
  if (features.horns) {
    for (const side of [-1, 1]) {
      const x = body.cx + side * body.rx * 0.55;
      parts.push(
        <path key={`horn-${side}`} className="avatar-line avatar-thick" d={`M ${x} ${crown + 6} q ${side * 3} -12 ${side * 11} -10 q ${side * 5} 3 ${side * 1} 7`} />,
      );
    }
  }
  if (features.tuft) {
    parts.push(
      <path key="tuft" className="avatar-line" d={`M ${body.cx} ${crown + 2} q -4 -10 -10 -12 M ${body.cx} ${crown + 2} q 0 -12 2 -15 M ${body.cx} ${crown + 2} q 5 -9 11 -10`} />,
    );
  }
  return parts;
}

function mouth(features: AvatarFeatures, body: Body, y: number): ReactNode {
  const half = features.wideMouth ? body.rx * 0.55 : 6;
  const depth = features.wideMouth ? 9 : 4;
  return <path className="avatar-line avatar-thin" d={`M ${body.cx - half} ${y} Q ${body.cx} ${y + depth} ${body.cx + half} ${y}`} />;
}

/** The whole picture, as SVG children, for these features. */
export function avatarParts(features: AvatarFeatures, asleep = false): ReactNode[] {
  const body = bodyFor(features);
  const eyeY = features.shell ? body.cy + body.ry * 0.12 : body.cy - body.ry * 0.28;
  const eyeDrop = features.eyes.ring && features.eyes.count > 2 ? 16 : features.eyes.shape === 'large' ? 18 : 13;
  const soft = features.build === 'soft';
  return [
    <ellipse key="ground" className="avatar-ground" cx={60} cy={113} rx={34} ry={3.5} />,
    ...behind(features, body),
    ...arms(features, body),
    soft ? (
      <rect key="body" className="avatar-body" x={body.cx - body.rx} y={body.cy - body.ry} width={body.rx * 2} height={body.ry * 2} rx={body.rx * 0.9} />
    ) : (
      <ellipse key="body" className="avatar-body" cx={body.cx} cy={body.cy} rx={body.rx} ry={body.ry} />
    ),
    ...onTop(features, body),
    ...eyes(features, body, eyeY, asleep),
    <g key="mouth">{mouth(features, body, eyeY + eyeDrop)}</g>,
  ];
}

/**
 * An agent's picture, drawn from its species note. The note is also the picture's text alternative,
 * so a screen reader hears what the drawing shows. The pose comes only from data: `asleep` (eyes
 * closed) while public_studio.paused is true, and the default drawing until the studio row loads.
 */
export function Avatar({ note, size = 96, asleep = false }: { note: string; size?: number; asleep?: boolean }) {
  const titleId = useId();
  const features = avatarFeatures(note);
  const style = { '--avatar-fill': `var(--creature-${features.colour})` } as CSSProperties;
  return (
    <svg
      className="avatar"
      role="img"
      aria-labelledby={titleId}
      // Drawn on a 120 grid; the view crops the empty margin so the creature fills the frame.
      viewBox="8 16 104 104"
      width={size}
      height={size}
      style={style}
      data-colour={features.colour}
      data-pose={asleep ? 'asleep' : 'awake'}
    >
      <title id={titleId}>{note}</title>
      {avatarParts(features, asleep)}
    </svg>
  );
}
