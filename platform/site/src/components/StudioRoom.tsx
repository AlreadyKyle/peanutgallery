import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { copy } from '../lib/copy';
import type { StudioDoc } from '../lib/community-types';
import { motionAllowed } from '../lib/motion';
import { rarityOf } from '../lib/suits';
import type { Snapshot } from '../lib/source';
import { eraKey, iso, placeAgents, roomPlan, type AgentPlace, type RoomPlan, type Spot } from '../lib/studio-scene';
import { Avatar, avatarFeatures, avatarParts } from './Avatar';
import { RoomDrawing, TILE, viewBoxOf } from './RoomDrawing';

// The live studio (docs/specs/final-state.md, The live studio; DESIGN.md, The live studio): the
// room an era gives, and the agents in it where the live data puts them. They walk between stations
// when the data moves them, bob while they work, type at the desks and chat in pairs with a small
// speech mark (never words). A coin drops through the pipe when a card's funding rises, a paper plane
// brings a suggestion, and a ship leaves the dock as a box. Hover, focus or a tap on an agent shows
// its role card; the same facts are written in the list under the room. Under reduced motion the
// room is drawn still, every agent at its station; an agent under the pointer or focus never moves.

export type Pulse = { id: string; kind: 'coin' | 'plane' | 'box'; cardId?: string };

const AGENT_SCALE = 0.42;
const WALK_MS_PER_TILE = 520;

type Anim = {
  from: Spot;
  to: Spot;
  start: number;
  dur: number;
  frozen: Spot | null;
  hopAt: number;
  phase: number;
};

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Where a walk has got to: along x first, then along y, as people walk between desks. */
function walkAt(anim: Anim, now: number): Spot {
  if (anim.frozen !== null) return anim.frozen;
  const t = anim.dur <= 0 ? 1 : Math.min(1, (now - anim.start) / anim.dur);
  if (t >= 1) return anim.to;
  const dx = anim.to.x - anim.from.x;
  const dy = anim.to.y - anim.from.y;
  const total = Math.abs(dx) + Math.abs(dy);
  if (total === 0) return anim.to;
  const along = ease(t) * total;
  if (along <= Math.abs(dx)) return { x: anim.from.x + Math.sign(dx) * along, y: anim.from.y };
  return { x: anim.to.x, y: anim.from.y + Math.sign(dy) * (along - Math.abs(dx)) };
}

function walking(anim: Anim, now: number): boolean {
  return anim.frozen === null && now - anim.start < anim.dur;
}

function screen(spot: Spot): { sx: number; sy: number } {
  return iso(spot.x, spot.y, 0, TILE);
}

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
  /** Draw the written list of facts under the room (the broadcast overlay leaves it out). */
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
  const titleId = useId();

  // Each agent's walk: a new target starts a walk from wherever it stands now.
  const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now());
  for (const place of places) {
    const was = anims.current.get(place.role.id);
    if (was === undefined) {
      anims.current.set(place.role.id, { from: place.spot, to: place.spot, start: 0, dur: 0, frozen: null, hopAt: -1e9, phase: Math.random() * Math.PI * 2 });
    } else if (was.to.x !== place.spot.x || was.to.y !== place.spot.y) {
      const t = now();
      const from = walkAt(was, t);
      const tiles = Math.abs(place.spot.x - from.x) + Math.abs(place.spot.y - from.y);
      const moving = motionAllowed();
      anims.current.set(place.role.id, {
        ...was,
        from: moving ? from : place.spot,
        to: place.spot,
        start: t,
        dur: moving ? Math.max(900, Math.min(4200, tiles * WALK_MS_PER_TILE)) : 0,
        frozen: was.frozen,
      });
    }
  }

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

  // The frame loop: walks, the idle bob, typing and a hop. It runs only while the room is on screen,
  // the tab is visible and motion is allowed; otherwise the room is drawn still.
  useEffect(() => {
    const draw = (t: number, still: boolean) => {
      for (const [id, el] of els.current) {
        const anim = anims.current.get(id);
        if (anim === undefined) continue;
        const spot = still ? (anim.frozen ?? anim.to) : walkAt(anim, t);
        const p = screen(spot);
        el.setAttribute('transform', `translate(${p.sx.toFixed(1)} ${p.sy.toFixed(1)})`);
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
  }, [places]);

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
    const from = anim.frozen;
    const tiles = Math.abs(anim.to.x - from.x) + Math.abs(anim.to.y - from.y);
    anims.current.set(id, { ...anim, frozen: null, from, start: now(), dur: tiles === 0 || !motionAllowed() ? 0 : Math.max(600, tiles * WALK_MS_PER_TILE) });
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
  const ordered = [...places].sort((a, b) => a.spot.x + a.spot.y - (b.spot.x + b.spot.y));
  const shipped = snapshot.cards.filter((card) => card.stage === 'live').length;
  const legendary = snapshot.cards.filter((card) => rarityOf(card) === 'legendary').length;
  const eraName = studio?.era.name ?? copy.studioRoom.eras.garage;

  let agentsNode: ReactNode = ordered.map((place) => {
    const anim = anims.current.get(place.role.id);
    const p = screen(anim === undefined ? place.spot : walkAt(anim, now()));
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
  });
  if (places.length === 0) agentsNode = null;

  return (
    <div className="studio">
      <div className="studio-stage" ref={container} data-era={plan.era}>
        <svg
          className="room"
          data-variant="live"
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          role="group"
          aria-labelledby={titleId}
          preserveAspectRatio="xMidYMid meet"
        >
          <title id={titleId}>{label ?? copy.studioRoom.svgTitle.replace('{era}', eraName)}</title>
          <RoomDrawing plan={plan} shipped={shipped} legendary={legendary} />
          {agentsNode}
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
                <span className="studio-fact-role">{place.role.title}</span>
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
