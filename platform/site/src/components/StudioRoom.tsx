import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { copy } from '../lib/copy';
import type { StudioDoc } from '../lib/community-types';
import { motionAllowed } from '../lib/motion';
import { rarityOf } from '../lib/suits';
import type { Snapshot } from '../lib/source';
import { crowded, eraKey, findPath, idleHaunts, iso, paintOrder, pathLength, placeAgents, roomPlan, seeded, type AgentPlace, type Box, type HauntKey, type RoomPlan, type Spot } from '../lib/studio-scene';
import { Avatar, avatarFeatures, avatarParts } from './Avatar';
import { roomLayers, TILE, viewBoxOf } from './RoomDrawing';

// The live studio (docs/specs/final-state.md, The live studio; DESIGN.md, The live studio): the
// room an era gives, and the agents in it where the live data puts them. They walk round the furniture
// between stations when the data moves them, bob while they work, type at the desks, and are drawn in
// one painter's order with the furniture, so an agent behind a desk stands behind it. An agent with no
// card never stands still for long: it wanders between the room's idle spots (the lounge, the
// whiteboard, the hopper, the bench, the dock, a window or the plant) on its own rhythm, and a
// chatting pair goes together and trades a small speech mark (never words) once both have arrived. A
// coin drops through the pipe when a card's funding rises, a paper plane brings a suggestion, and a
// ship leaves the dock as a box. Hover, focus or a tap on an agent shows its role card; the same facts
// are written in a list under the room for screen readers and the keyboard, which shows only while
// focus is in it (the board, 17 October 2026: the visible list pushed the page down and repeated the
// role cards). Under reduced motion the room is drawn still, every agent at its place in the data; an
// agent under the pointer or focus never moves.

export type Pulse = { id: string; kind: 'coin' | 'plane' | 'box'; cardId?: string };

const AGENT_SCALE = 0.42;
const WALK_MS_PER_TILE = 520;
/** How long an idle agent stays at a spot before it wanders on: between these, its own rhythm. */
const REST_MS = [4500, 11000] as const;
const IDLE: ReadonlySet<AgentPlace['activity']> = new Set(['chatting', 'reading', 'resting']);

type Pose = 'walk' | 'rest' | 'away';

type Anim = {
  /** The walk under way, corner to corner; its last spot is where the agent is going. */
  path: Spot[];
  len: number;
  start: number;
  dur: number;
  /** Where the live data puts the agent: its station, or its lounge spot when it has no card. */
  home: Spot;
  frozen: Spot | null;
  hopAt: number;
  phase: number;
  /** The second of a chatting pair speaks while the first listens. */
  chatFlip?: boolean;
  /** An agent with no card wanders between the room's idle spots. */
  wander: boolean;
  haunt: HauntKey | null;
  restUntil: number;
  leg: number;
  /** A pair's leader picks where they go; this is the spot it keeps for its partner. */
  pairSpot: Spot | null;
  pose: Pose | null;
};

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

const target = (anim: Anim): Spot => anim.path[anim.path.length - 1]!;

/** Where a walk has got to, along its corners. */
function walkAt(anim: Anim, now: number): Spot {
  if (anim.frozen !== null) return anim.frozen;
  const t = anim.dur <= 0 ? 1 : Math.min(1, Math.max(0, (now - anim.start) / anim.dur));
  if (t >= 1 || anim.len === 0) return target(anim);
  let left = ease(t) * anim.len;
  for (let i = 1; i < anim.path.length; i += 1) {
    const a = anim.path[i - 1]!;
    const b = anim.path[i]!;
    const leg = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (left <= leg) {
      const f = leg === 0 ? 1 : left / leg;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    left -= leg;
  }
  return target(anim);
}

function walking(anim: Anim, now: number): boolean {
  return anim.frozen === null && now - anim.start < anim.dur;
}

/** Start a walk round the furniture from where the agent is to `to`; under reduced motion it is there at once. */
function walkTo(anim: Anim, plan: RoomPlan, to: Spot, now: number, min = 700): void {
  const from = walkAt(anim, now);
  if (!motionAllowed()) {
    anim.path = [to];
    anim.len = 0;
    anim.dur = 0;
    anim.start = now;
    return;
  }
  const path = findPath(plan, from, to);
  const len = pathLength(path);
  anim.path = path;
  anim.len = len;
  anim.start = now;
  anim.dur = len === 0 ? 0 : Math.max(min, Math.min(7000, len * WALK_MS_PER_TILE));
}

function screen(spot: Spot): { sx: number; sy: number } {
  return iso(spot.x, spot.y, 0, TILE);
}

/** An agent's footprint, for the painter's order with the furniture. */
const footAt = (spot: Spot): Box => ({ x: spot.x - 0.15, y: spot.y - 0.15, w: 0.3, d: 0.3, h: 1.5 });

/** The small mark over an agent that says what it is doing, drawn, never written. */
function ActivityMark({ place }: { place: AgentPlace }) {
  const y = -50;
  switch (place.activity) {
    case 'building':
      return (
        <g className="agent-mark agent-typing" transform={`translate(0 ${y})`}>
          <rect className="mark-bubble" x={-13} y={-7} width={26} height={14} rx={7} />
          <circle className="mark-dot" cx={-6} cy={0} r={1.8} />
          <circle className="mark-dot" cx={0} cy={0} r={1.8} />
          <circle className="mark-dot" cx={6} cy={0} r={1.8} />
        </g>
      );
    case 'chatting':
      return (
        <g className="agent-mark agent-chat" transform={`translate(8 ${y})`}>
          <path className="mark-bubble" d="M-12 -8h24a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-14l-6 6v-6h-4a4 4 0 0 1-4-4v-8a4 4 0 0 1 4-4z" />
          <path className="mark-ink" d="M-7 -2h14M-7 2h9" />
        </g>
      );
    case 'checks':
      return (
        <g className="agent-mark" transform={`translate(0 ${y})`}>
          <rect className="mark-bubble" x={-9} y={-9} width={18} height={18} rx={4} />
          <path className="mark-ink" d="M-4.5 0l3 3 6-6" />
        </g>
      );
    case 'review':
      return (
        <g className="agent-mark" transform={`translate(0 ${y})`}>
          <rect className="mark-bubble" x={-9} y={-9} width={18} height={18} rx={4} />
          <circle className="mark-ink" cx={-1} cy={-1} r={3.5} />
          <path className="mark-ink" d="M1.8 1.8l3.5 3.5" />
        </g>
      );
    case 'drafting':
      return (
        <g className="agent-mark" transform={`translate(0 ${y})`}>
          <rect className="mark-bubble" x={-9} y={-9} width={18} height={18} rx={4} />
          <path className="mark-ink" d="M-4 4l1-3.5 6-6 2.5 2.5-6 6z" />
        </g>
      );
    case 'paused':
      return (
        <g className="agent-mark" transform={`translate(6 ${y + 4})`}>
          <path className="mark-ink" d="M-4 -6h7l-7 7h7M4 -12h5l-5 5h5" />
        </g>
      );
    case 'reading':
      return (
        <g className="agent-mark" transform={`translate(0 ${y})`}>
          <path className="mark-bubble" d="M-10 -6l10 2 10-2v12l-10 2-10-2z" />
          <path className="mark-ink" d="M0 -4v12" />
        </g>
      );
    case 'shipping':
      return (
        <g className="agent-mark" transform={`translate(0 ${y})`}>
          <path className="mark-bubble" d="M-9 -4l9-5 9 5v9l-9 5-9-5z" />
          <path className="mark-ink" d="M-9 -4l9 5 9-5M0 1v9" />
        </g>
      );
    default:
      return null;
  }
}

function AgentFigure({ place }: { place: AgentPlace }) {
  const features = avatarFeatures(place.role.species_note);
  const style = { '--avatar-fill': `var(--creature-${features.colour})` } as CSSProperties;
  const s = AGENT_SCALE;
  return (
    <>
      <ellipse className="agent-ring" cx={0} cy={0} rx={22} ry={11} />
      <g className="agent-body">
        <g className="avatar" style={style} transform={`translate(${-60 * s} ${-113 * s}) scale(${s})`}>
          {avatarParts(features, place.asleep)}
        </g>
        <ActivityMark place={place} />
      </g>
    </>
  );
}

function doingLine(place: AgentPlace): string {
  return `${place.role.name}, ${place.role.title}. ${place.doing}`;
}

/** The role card an agent shows on hover, focus or tap: its name, role, what it is doing, the link. */
function RoleCard({ place, at, onEnter, onLeave }: { place: AgentPlace; at: { left: number; top: number }; onEnter: () => void; onLeave: () => void }) {
  const below = at.top < 34;
  return (
    <div
      className="role-card"
      data-below={below ? 'true' : undefined}
      style={{ left: `${Math.min(86, Math.max(14, at.left))}%`, top: `${at.top}%` }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <Avatar note={place.role.species_note} size={44} asleep={place.asleep} />
      <div>
        <p className="role-card-name">{place.role.name}</p>
        <p className="role-card-title">{place.role.title}</p>
        <p className="role-card-doing">{place.doing}</p>
        {place.card === null ? (
          <Link to={`/team#agent-${place.role.id}`}>{copy.studioRoom.meet}</Link>
        ) : (
          <Link to={`/card/${place.card.id}`}>{copy.studioRoom.openCard}</Link>
        )}
      </div>
    </div>
  );
}

/** The sprites a pulse plays: a coin down the pipe, a paper plane to the whiteboard, a box off the dock. */
function Sprite({ pulse, plan, onDone }: { pulse: Pulse; plan: RoomPlan; onDone: (id: string) => void }) {
  const ref = useRef<SVGGElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof el.animate !== 'function') {
      onDone(pulse.id);
      return;
    }
    const at = (x: number, y: number, z: number) => {
      const p = iso(x, y, z, TILE);
      return `translate(${p.sx.toFixed(1)}px, ${p.sy.toFixed(1)}px)`;
    };
    let frames: Keyframe[];
    let duration: number;
    if (pulse.kind === 'coin') {
      frames = [
        { transform: at(plan.pipeX, 0.06, plan.wall + 0.9), opacity: 0 },
        { transform: at(plan.pipeX, 0.06, plan.wall + 0.6), opacity: 1, offset: 0.12 },
        { transform: at(plan.pipeX, 0.06, plan.hopper.h + 0.25), opacity: 1, offset: 0.78 },
        { transform: at(plan.pipeX, 0.5, plan.hopper.h - 0.1), opacity: 0 },
      ];
      duration = 1400;
    } else if (pulse.kind === 'plane') {
      const wx = (plan.windows[0] ?? 4) + 0.75;
      frames = [
        { transform: `${at(wx, 0.1, 1.8)} rotate(0deg)`, opacity: 0 },
        { transform: `${at(wx - 1, 1.2, 2.3)} rotate(-8deg)`, opacity: 1, offset: 0.2 },
        { transform: `${at(1.6, 2.6, 2.4)} rotate(6deg)`, opacity: 1, offset: 0.75 },
        { transform: `${at(0.3, 2.6, 1.7)} rotate(0deg)`, opacity: 0 },
      ];
      duration = 2600;
    } else {
      const k = plan.dock;
      frames = [
        { transform: at(k.x + 1.0, k.y + 1.2, k.h), opacity: 0 },
        { transform: at(k.x + 1.0, k.y + 1.2, k.h), opacity: 1, offset: 0.15 },
        { transform: at(k.x + k.w + 0.6, k.y + 1.2, k.h), opacity: 1, offset: 0.7 },
        { transform: at(k.x + k.w + 1.8, k.y + 1.2, k.h), opacity: 0 },
      ];
      duration = 2200;
    }
    const animation = el.animate(frames, { duration, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' });
    animation.finished.then(() => onDone(pulse.id)).catch(() => onDone(pulse.id));
    return () => animation.cancel();
  }, [pulse, plan, onDone]);
  return (
    <g ref={ref} className="sprite" data-sprite={pulse.kind} style={{ opacity: 0 }}>
      {pulse.kind === 'coin' ? (
        <>
          <circle className="coin-face" cx={0} cy={-6} r={7} />
          <circle className="sprite-line" cx={0} cy={-6} r={4} />
        </>
      ) : pulse.kind === 'plane' ? (
        <path className="sprite-paper" d="M-12 0l26-10-8 16-5-5zM1 1l13-11" />
      ) : (
        <g>
          <path className="sprite-paper" d="M-12 -14l12-6 12 6v12l-12 6-12-6z" />
          <path className="sprite-line" d="M-12 -14l12 6 12-6M0 -8v12" />
        </g>
      )}
    </g>
  );
}

export type StudioRoomProps = {
  snapshot: Snapshot;
  studio: StudioDoc | null;
  pulses?: readonly Pulse[];
  /** Write the list of facts under the room, for screen readers and the keyboard (the broadcast overlay leaves it out). */
  facts?: boolean;
  label?: string;
};

export function StudioRoom({ snapshot, studio, pulses = [], facts = true, label }: StudioRoomProps) {
  const key = eraKey(studio?.era ?? null);
  const plan = useMemo(() => roomPlan(key, studio?.era.decor.length ? studio.era.decor : undefined), [key, studio]);
  const places = useMemo(() => placeAgents(snapshot, plan), [snapshot, plan]);
  const vb = viewBoxOf(plan);
  const anims = useRef(new Map<string, Anim>());
  const els = useRef(new Map<string, SVGGElement>());
  const bodies = useRef(new Map<string, SVGGElement>());
  const container = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<{ id: string; at: Spot } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sprites, setSprites] = useState<Pulse[]>([]);
  const seenPulses = useRef(new Set<string>());
  const activeRef = useRef<{ id: string; at: Spot } | null>(null);
  activeRef.current = active;
  const shipped = snapshot.cards.filter((card) => card.stage === 'live').length;
  const legendary = snapshot.cards.filter((card) => rarityOf(card) === 'legendary').length;

  const layers = useMemo(() => roomLayers(plan, shipped, legendary), [plan, shipped, legendary]);
  const haunts = useMemo(() => idleHaunts(plan), [plan]);
  const [, setOrderTick] = useState(0);

  // Each agent's walk: a new place in the data starts a walk round the furniture from wherever it
  // stands now. An agent with no card keeps wandering; one given a card walks to its station at once.
  const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());
  for (const place of places) {
    const id = place.role.id;
    const idle = IDLE.has(place.activity);
    const was = anims.current.get(id);
    if (was === undefined) {
      const t = now();
      anims.current.set(id, {
        path: [place.spot],
        len: 0,
        start: 0,
        dur: 0,
        home: place.spot,
        frozen: null,
        hopAt: -1e9,
        phase: seeded(id, 0) * Math.PI * 2,
        wander: idle,
        haunt: place.haunt ?? 'lounge',
        // The first stroll starts at a different moment for each agent, so they never set off together.
        restUntil: t + 1200 + seeded(id, 1) * 5000,
        leg: 0,
        pairSpot: null,
        pose: null,
      });
    } else if (was.home.x !== place.spot.x || was.home.y !== place.spot.y || was.wander !== idle) {
      const t = now();
      const joined = !was.wander && idle;
      was.home = place.spot;
      was.wander = idle;
      // Given a card, or back from one: straight to the new place. Already wandering: carry on.
      if (!idle || joined || !motionAllowed()) {
        walkTo(was, plan, place.spot, t, 900);
        was.haunt = place.haunt ?? 'lounge';
        was.restUntil = t + was.dur + REST_MS[0];
      }
    }
    anims.current.get(id)!.chatFlip = place.partner !== null && id > place.partner;
  }

  /** Where every agent stands right now: under reduced motion, at its place in the data. */
  const spotOf = (anim: Anim, t: number): Spot => (motionAllowed() ? walkAt(anim, t) : (anim.frozen ?? anim.home));

  /** The painter's order of the furniture and the agents, back to front, as keys. */
  const orderAt = (t: number): string[] => {
    const items: { key: string; foot: Box }[] = layers.pieces.map((piece) => ({ key: `piece:${piece.key}`, foot: piece.foot }));
    for (const place of places) {
      const anim = anims.current.get(place.role.id);
      items.push({ key: `agent:${place.role.id}`, foot: footAt(anim === undefined ? place.spot : spotOf(anim, t)) });
    }
    return paintOrder(items.map((item) => item.foot)).map((i) => items[i]!.key);
  };

  /**
   * The next stroll for an idle agent that has rested long enough: another of the room's idle spots,
   * clear of everyone else's, where they are or where they are going. The leader of a chatting pair
   * takes a pair of spots and keeps the second for its partner, who follows.
   */
  const wander = (t: number) => {
    const all = [...anims.current.values()];
    const ends = all.map((anim) => ({ anim, spot: target(anim) }));
    const free = (spot: Spot, self: Anim, partner?: Anim) => ends.every((end) => end.anim === self || end.anim === partner || !crowded(end.spot, spot));
    for (const place of places) {
      const anim = anims.current.get(place.role.id);
      if (anim === undefined || !anim.wander || anim.frozen !== null) continue;
      const partner = place.partner === null ? undefined : anims.current.get(place.partner);
      const follower = partner !== undefined && place.role.id > place.partner!;
      if (follower) {
        // The follower goes where its leader went, once the leader has set off.
        if (partner.leg !== anim.leg && partner.pairSpot !== null && !walking(anim, t)) {
          walkTo(anim, plan, partner.pairSpot, t);
          anim.haunt = partner.haunt;
          anim.leg = partner.leg;
          anim.restUntil = partner.restUntil;
        }
        continue;
      }
      if (walking(anim, t) || t < anim.restUntil) continue;
      if (partner !== undefined && (partner.frozen !== null || walking(partner, t))) continue;
      // Where each haunt has room: a clear pair of spots for a pair, a clear spot for one alone.
      const choices = haunts
        .filter((haunt) => haunt.key !== anim.haunt)
        .map((haunt) => ({
          haunt,
          spots: partner === undefined ? haunt.spots.filter((spot) => free(spot, anim)) : [],
          pairs: partner === undefined ? [] : haunt.pairs.filter(([a, b]) => free(a, anim, partner) && free(b, anim, partner)),
        }))
        .filter((choice) => choice.spots.length > 0 || choice.pairs.length > 0);
      if (choices.length === 0) {
        anim.restUntil = t + REST_MS[0];
        continue;
      }
      // The lounge counts twice: between cards the agents come back to it most.
      const weighted = choices.flatMap((choice) => (choice.haunt.key === 'lounge' ? [choice, choice] : [choice]));
      const choice = weighted[Math.floor(seeded(place.role.id, 10 + anim.leg) * weighted.length)]!;
      const pick = seeded(place.role.id, 100 + anim.leg);
      const pair = choice.pairs[Math.floor(pick * choice.pairs.length)];
      const flip = seeded(place.role.id, 200 + anim.leg) < 0.5;
      const spot = pair === undefined ? choice.spots[Math.floor(pick * choice.spots.length)]! : flip ? pair[1] : pair[0];
      walkTo(anim, plan, spot, t);
      ends.push({ anim, spot });
      anim.haunt = choice.haunt.key;
      anim.leg += 1;
      anim.restUntil = t + anim.dur + REST_MS[0] + seeded(place.role.id, 1000 + anim.leg) * (REST_MS[1] - REST_MS[0]);
      anim.pairSpot = pair === undefined ? null : flip ? pair[0] : pair[1];
      if (anim.pairSpot !== null && partner !== undefined) ends.push({ anim: partner, spot: anim.pairSpot });
    }
  };

  // New pulses: the sprite plays, and the agents on that card (or at the desks) hop.
  useEffect(() => {
    const fresh = pulses.filter((pulse) => !seenPulses.current.has(pulse.id));
    if (fresh.length === 0) return;
    for (const pulse of fresh) seenPulses.current.add(pulse.id);
    if (!motionAllowed() || document.visibilityState === 'hidden') return;
    setSprites((was) => [...was, ...fresh.slice(0, 3)]);
    const t = now();
    for (const pulse of fresh) {
      const onCard = places.filter((place) => pulse.cardId !== undefined && place.card?.id === pulse.cardId);
      const reacting = onCard.length > 0 ? onCard : places.filter((place) => place.activity === 'building' || place.activity === 'drafting' || place.activity === 'checks');
      for (const place of reacting) {
        const anim = anims.current.get(place.role.id);
        if (anim !== undefined) anim.hopAt = t + (pulse.kind === 'coin' ? 1100 : 300);
      }
    }
  }, [pulses, places]);

  const spriteDone = useCallback((id: string) => setSprites((was) => was.filter((sprite) => sprite.id !== id)), []);

  // The frame loop: walks, idle strolls, the bob, typing and a hop. It runs only while the room is on
  // screen, the tab is visible and motion is allowed; otherwise the room is drawn still, every agent at
  // its place in the data.
  useEffect(() => {
    let order = '';
    let ordered = 0;
    const draw = (t: number, still: boolean) => {
      if (!still) wander(t);
      for (const [id, el] of els.current) {
        const anim = anims.current.get(id);
        if (anim === undefined) continue;
        const spot = still ? (anim.frozen ?? anim.home) : walkAt(anim, t);
        const p = screen(spot);
        el.setAttribute('transform', `translate(${p.sx.toFixed(1)} ${p.sy.toFixed(1)})`);
        // The mark over an agent shows what it is doing where it does it: none on a walk, the book only in the lounge.
        const pose: Pose = !still && walking(anim, t) ? 'walk' : anim.wander && anim.haunt !== 'lounge' && !still ? 'away' : 'rest';
        if (pose !== anim.pose) {
          el.setAttribute('data-pose', pose);
          anim.pose = pose;
        }
        const body = bodies.current.get(id);
        if (body === undefined) continue;
        let lift = 0;
        if (!still) {
          if (walking(anim, t)) lift = -Math.abs(Math.sin(t / 140 + anim.phase)) * 3;
          else if (anim.frozen === null) lift = Math.sin(t / 700 + anim.phase) * 1.1;
          const hop = (t - anim.hopAt) / 520;
          if (hop >= 0 && hop <= 1) lift -= Math.sin(Math.PI * hop) * 9;
        }
        body.setAttribute('transform', `translate(0 ${lift.toFixed(2)})`);
        // Drawn still, one of a chatting pair holds the speech mark: never two over one conversation.
        if (still) {
          body.querySelector<SVGElement>('.agent-chat')?.setAttribute('opacity', anim.chatFlip === true ? '0' : '1');
          continue;
        }
        // Typing: the three dots light one after another. Chatting: the two bubbles take turns, once
        // both are standing together.
        const dots = body.querySelectorAll<SVGElement>('.mark-dot');
        dots.forEach((dot, i) => dot.setAttribute('opacity', String(0.25 + 0.75 * Math.max(0, Math.sin(t / 220 - i * 0.9 + anim.phase)))));
        const chat = body.querySelector<SVGElement>('.agent-chat');
        if (chat !== null) {
          const place = places.find((one) => one.role.id === id);
          const partner = place?.partner == null ? undefined : anims.current.get(place.partner);
          const together = partner !== undefined && !walking(anim, t) && !walking(partner, t) && partner.haunt === anim.haunt;
          chat.setAttribute('opacity', together && Math.sin(t / 1300 + (anim.chatFlip ? Math.PI : 0)) > 0 ? '1' : '0');
        }
      }
      // Who stands in front of what changes as they walk: redraw in the new order, a few times a
      // second at most, and never while a role card is open over an agent.
      if (!still && t - ordered > 250 && activeRef.current === null) {
        ordered = t;
        const next = orderAt(t).join(' ');
        if (order !== '' && next !== order) setOrderTick((n) => n + 1);
        order = next;
      }
    };
    if (!motionAllowed()) {
      draw(0, true);
      return;
    }
    let frame = 0;
    let onScreen = true;
    const loop = (t: number) => {
      draw(t, false);
      frame = onScreen && document.visibilityState === 'visible' ? requestAnimationFrame(loop) : 0;
    };
    const start = () => {
      if (frame === 0 && onScreen && document.visibilityState === 'visible') frame = requestAnimationFrame(loop);
    };
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            onScreen = entries.some((entry) => entry.isIntersecting);
            start();
          });
    if (container.current !== null) observer?.observe(container.current);
    document.addEventListener('visibilitychange', start);
    start();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', start);
    };
    // The loop reads the agents through refs and the room through closures made for these places.
  }, [places, plan, layers, haunts]);

  const show = (id: string) => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    const anim = anims.current.get(id);
    if (anim === undefined) return;
    // An agent under the pointer or focus holds still until it is let go.
    const here = walkAt(anim, now());
    anim.frozen = here;
    setActive({ id, at: here });
  };
  const release = (id: string) => {
    const anim = anims.current.get(id);
    if (anim === undefined || anim.frozen === null) return;
    // It walks on from where it was held to where it was going, and an idle one rests a moment first.
    const t = now();
    const held = anim.frozen;
    const to = target(anim);
    anim.frozen = null;
    anim.path = [held];
    anim.len = 0;
    anim.dur = 0;
    anim.start = t;
    walkTo(anim, plan, to, t, 600);
    if (anim.wander) anim.restUntil = Math.max(anim.restUntil, t + anim.dur + 1500);
  };
  const hide = (id: string, delay = 160) => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      release(id);
      setActive((was) => (was?.id === id ? null : was));
    }, delay);
  };

  useEffect(() => {
    if (active === null) return;
    const onDown = (event: PointerEvent) => {
      if (container.current !== null && !container.current.contains(event.target as Node)) hide(active.id, 0);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  });

  const activePlace = active === null ? null : (places.find((place) => place.role.id === active.id) ?? null);
  const activeAt = active === null ? null : screen(active.at);
  const eraName = studio?.era.name ?? copy.studioRoom.eras.garage;

  const agentNode = (place: AgentPlace): ReactNode => {
    const anim = anims.current.get(place.role.id);
    const p = screen(anim === undefined ? place.spot : spotOf(anim, now()));
    return (
      <g
        key={place.role.id}
        ref={(el) => {
          if (el === null) els.current.delete(place.role.id);
          else els.current.set(place.role.id, el);
        }}
        className="studio-agent"
        data-activity={place.activity}
        data-role={place.role.id}
        transform={`translate(${p.sx.toFixed(1)} ${p.sy.toFixed(1)})`}
        tabIndex={0}
        role="button"
        aria-label={doingLine(place)}
        aria-expanded={active?.id === place.role.id}
        onMouseEnter={() => show(place.role.id)}
        onMouseLeave={() => hide(place.role.id)}
        onFocus={() => show(place.role.id)}
        onBlur={() => hide(place.role.id, 0)}
        onClick={() => (active?.id === place.role.id ? hide(place.role.id, 0) : show(place.role.id))}
        onKeyDown={(event) => {
          if (event.key === 'Escape') hide(place.role.id, 0);
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (active?.id === place.role.id) hide(place.role.id, 0);
            else show(place.role.id);
          }
        }}
      >
        <g
          ref={(el) => {
            if (el === null) bodies.current.delete(place.role.id);
            else bodies.current.set(place.role.id, el);
          }}
        >
          <AgentFigure place={place} />
        </g>
      </g>
    );
  };
  // The furniture and the agents in one painter's order, so an agent behind a desk is drawn behind it.
  const byId = new Map(places.map((place) => [place.role.id, place]));
  const pieceByKey = new Map(layers.pieces.map((piece) => [piece.key, piece]));
  const standing: ReactNode = orderAt(now()).map((key) => {
    const [kind, id] = key.split(/:(.*)/s) as [string, string];
    if (kind === 'agent') return agentNode(byId.get(id)!);
    return <g key={key}>{pieceByKey.get(id)!.node}</g>;
  });

  return (
    <div className="studio">
      <div className="studio-stage" ref={container} data-era={plan.era}>
        {/* Named by aria-label, not a <title>: a title shows as the browser's own tooltip over the room. */}
        <svg
          className="room"
          data-variant="live"
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          role="group"
          aria-label={label ?? copy.studioRoom.svgTitle.replace('{era}', eraName)}
          preserveAspectRatio="xMidYMid meet"
        >
          <g className="room-drawing">{layers.back}</g>
          {standing}
          {sprites.map((pulse) => (
            <Sprite key={pulse.id} pulse={pulse} plan={plan} onDone={spriteDone} />
          ))}
        </svg>
        {activePlace !== null && activeAt !== null ? (
          <RoleCard
            place={activePlace}
            at={{ left: ((activeAt.sx - vb.x) / vb.w) * 100, top: ((activeAt.sy - 46 - vb.y) / vb.h) * 100 }}
            onEnter={() => closeTimer.current !== null && clearTimeout(closeTimer.current)}
            onLeave={() => hide(activePlace.role.id)}
          />
        ) : null}
        <p className="studio-era">
          <span className="studio-era-word">{copy.studioRoom.eraLabel}</span> {eraName}
        </p>
      </div>
      {facts ? (
        places.length === 0 ? (
          <p className="muted studio-empty">{copy.studioRoom.empty}</p>
        ) : (
          <ul className="studio-facts" aria-label={copy.studioRoom.factsLabel}>
            {places.map((place) => (
              <li key={place.role.id} data-activity={place.activity}>
                <span className="studio-fact-name">{place.role.name}</span>
                {place.role.title === place.role.name ? null : <span className="studio-fact-role">{place.role.title}</span>}
                <span className="studio-fact-doing">
                  {place.doing}{' '}
                  {place.card === null ? null : (
                    <Link to={`/card/${place.card.id}`} aria-label={copy.studioRoom.openCardNamed.replace('{title}', place.card.title)}>
                      {copy.studioRoom.openCard}
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
