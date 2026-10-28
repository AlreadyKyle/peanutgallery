import { useCurrentFrame } from 'remotion';
import { copy } from '../../../site/src/lib/copy';
import { at, pop, progress, shake, tween, wobble } from '../anim';
import { Avatar } from '../components/Avatar';
import { Card, CARD, type CardFace } from '../components/Card';
import { Coin } from '../components/Coin';
import { EventLog } from '../components/EventLog';
import { At, Stage } from '../components/Stage';
import { builder, hand, HERO, labels, shipped } from '../data';
import type { Format } from '../format';
import { C, EASE_IN, EASE_IN_OUT, EASE_OUT, FONT } from '../theme';
import { BEAT, CHOREO, sceneBar, type SceneId } from '../timeline';

// The steps as one unbroken shot: one real card from the deck is picked, funded, built and shipped,
// and never leaves the table. Frames here count from the start of Pick.

/** Frames from the start of Pick to `barsIn` bars into `scene`. */
function J(scene: SceneId, barsIn: number): number {
  return at(sceneBar(scene) - sceneBar('pick') + barsIn);
}

const HAND_SCALE = 0.62;
/** The card on its own in Pick and Fills. */
const HERO_SCALE = 1.14;
const FAN = [-13, -4.5, 4.5, 13];
const FAN_RADIUS = 760;
const DECK = { x: 450, y: 1150 };
/** Where the card's funding bar sits from the card's centre, unscaled, with no line under it. */
const BAR_DY = CARD.height / 2 - 4 - 34 - 9;
const BAR_HALF = CARD.width / 2 - 38;

function slot(i: number): { x: number; y: number; r: number } {
  const a = (FAN[i]! * Math.PI) / 180;
  return { x: 450 + Math.sin(a) * FAN_RADIUS, y: 520 + (1 - Math.cos(a)) * FAN_RADIUS, r: FAN[i]! };
}

/** A flip in place (motion.ts flip): 0 to 90 degrees, the face swaps, 90 back to 0. */
function flipAt(frame: number, t: number): { angle: number; past: boolean; lift: number } {
  const half = 11;
  const first = tween(frame, t, half, 0, 90, EASE_IN);
  const second = tween(frame, t + half, half, 90, 0, EASE_OUT);
  const angle = frame < t + half ? first : second;
  const k = progress(frame, t, half * 2, EASE_IN_OUT);
  return { angle, past: frame >= t + half, lift: Math.sin(k * Math.PI) };
}

const FLIPS: readonly { face: CardFace; t: number }[] = [
  { face: 'funded', t: J('fills', CHOREO.fills.flip) },
  { face: 'building', t: J('build', CHOREO.build.flip) },
  { face: 'live', t: J('shipped', CHOREO.shipped.flip) },
];

/** The fill after each of the four coins in Fills, from empty. */
const FILLS = [0, 0.25, 0.5, 0.75, 1];
/** A coin takes this many frames to fall onto the bar. */
const FALL = 18;

export function Journey({ format }: { format: Format }) {
  const f = useCurrentFrame();

  // ---- The card's path ----------------------------------------------------------------------
  const lift = J('pick', CHOREO.pick.lift);
  const q = pop(f, lift, 'soft');
  const heroSlot = slot(HERO);
  const deal = (i: number) => pop(f, J('pick', CHOREO.pick.deal[i]!), 'snappy');
  const inHand = (i: number) => {
    const p = deal(i);
    const s = slot(i);
    const arc = Math.sin(Math.min(1, p) * Math.PI) * 140;
    return { x: DECK.x + (s.x - DECK.x) * p, y: DECK.y + (s.y - DECK.y) * p - arc, r: (i - 1.5) * -18 * (1 - p) + s.r * p };
  };
  let x = inHand(HERO).x;
  let y = inHand(HERO).y;
  let s = HAND_SCALE;
  let r = inHand(HERO).r;
  const move = (k: number, tx: number, ty: number, ts: number, tr: number) => {
    x += (tx - x) * k;
    y += (ty - y) * k;
    s += (ts - s) * k;
    r += (tr - r) * k;
  };
  move(q, 450, 400, HERO_SCALE, 0);
  move(progress(f, J('fills', 0), 36, EASE_IN_OUT), 450, 430, HERO_SCALE, 0);
  move(progress(f, J('fills', CHOREO.fills.queue), 44, EASE_IN_OUT), 260, 250, 1, 0);
  // On the phone cuts the pile is centred under the words, so the card first rises to the middle. The
  // 9:16 cut's captions run a line longer, so its pile stays low instead of rising into them.
  const tall = format.name !== 'wide';
  const vertical = format.name === 'vertical';
  const PILE = tall ? { x: 450, y: vertical ? 640 : 612 } : { x: 600, y: 602 };
  if (tall) move(progress(f, J('shipped', 0), 30, EASE_IN_OUT), 450, 190, 1, 0);
  const slam = J('shipped', CHOREO.shipped.slam);
  const toPile = progress(f, slam - 26, 26, EASE_IN);
  move(toPile, PILE.x, PILE.y - 12, 1, -1.5);
  y -= Math.sin(toPile * Math.PI) * 90;
  // Once it has landed, the pile and the card on it settle up to the middle of the stage.
  const settle = progress(f, slam + 24, 44, EASE_IN_OUT) * (vertical ? 0 : tall ? 150 : 90);
  y -= settle;
  const landed = f >= slam ? Math.exp(-(f - slam) / 5) * Math.sin((f - slam) * 0.9) : 0;
  s *= 1 + landed * 0.035;
  // Between moves the lifted card breathes, a few pixels and a fraction of a degree, until it lands.
  const breathing = q * (1 - toPile);
  y += wobble(f, 1, 3, 170) * breathing;
  r += wobble(f, 2, 0.4, 210) * breathing;
  const exit = progress(f, J('shipped', CHOREO.shipped.exit), 26, EASE_IN);
  y += exit * 900;

  // ---- The card's face -----------------------------------------------------------------------
  let face: CardFace = 'open';
  let flipAngle = 0;
  let flipLift = 0;
  for (const flip of FLIPS) {
    const state = flipAt(f, flip.t);
    if (f >= flip.t && f < flip.t + 22) {
      flipAngle = state.angle;
      flipLift = state.lift;
    }
    if (state.past) face = flip.face;
  }
  const coinLand = CHOREO.fills.coins.map((c) => J('fills', c) + FALL);
  let fill = FILLS[0]!;
  coinLand.forEach((t, i) => {
    fill += tween(f, t, 10, 0, FILLS[i + 1]! - FILLS[i]!);
  });
  const meta = face === 'funded' ? labels.waiting : face === 'building' ? copy.buildingBy.replace('{name}', builder.title) : null;
  const gear = face === 'building' ? (f - FLIPS[1]!.t) * 2.4 : 0;
  const stamp = face === 'live' ? pop(f, J('shipped', CHOREO.shipped.stamp), 'snappy') : 0;
  const pulse = Math.sin(progress(f, J('pick', CHOREO.pick.target), 36) * Math.PI);

  // ---- The hand's other cards fall away as the card is lifted ---------------------------------
  const others = hand.map((title, i) => {
    if (i === HERO) return null;
    const p = inHand(i);
    const away = progress(f, lift + Math.abs(i - HERO) * 3, 30, EASE_IN);
    if (away >= 1) return null;
    return (
      <At key={title} x={p.x + (i - HERO) * 40 * away} y={p.y + away * 720} w={CARD.width} h={CARD.height} scale={HAND_SCALE} rotate={p.r + (i < HERO ? -1 : 1) * away * 24} opacity={1 - away * 0.6}>
        <Card title={title} face="open" style={{ left: 0, top: 0 }} />
      </At>
    );
  });

  // ---- Fills: the coins that fill the bar -----------------------------------------------------
  const fillCoins = CHOREO.fills.coins.map((c, i) => {
    const t = J('fills', c);
    if (f < t || f > t + FALL + 10) return null;
    const fall = progress(f, t, FALL, EASE_IN);
    const soak = progress(f, t + FALL, 10);
    const barY = 430 + BAR_DY * HERO_SCALE;
    const tx = 450 - BAR_HALF * HERO_SCALE + BAR_HALF * HERO_SCALE * 2 * FILLS[i + 1]! - 24;
    return <Coin key={i} size={64} x={tx} y={-140 + (barY - 18 + 140) * fall} turn={Math.cos(fall * Math.PI * 4)} opacity={1 - soak} />;
  });

  // ---- Build: the builder and its steps ------------------------------------------------------
  const agentIn = progress(f, J('build', CHOREO.build.agent), 40, EASE_OUT);
  const agentOut = progress(f, J('shipped', CHOREO.shipped.flip), 30, EASE_IN);
  const agentX = 1080 - (1080 - 690) * agentIn + agentOut * 520;
  const agentHop = Math.abs(Math.sin(agentIn * Math.PI * 3)) * 46 * (1 - agentIn) + Math.abs(Math.sin(agentOut * Math.PI * 3)) * 40;
  const beatHop = agentIn >= 1 && agentOut === 0 ? Math.max(0, Math.sin((((f % BEAT) / BEAT) * Math.PI))) * 7 : 0;
  const ev = labels.events;
  const who = builder.title;
  const rows = [ev.started, ev.read, ev.edited, ev.ran, ev.submitted].map((line, i) => ({ text: `${who} ${line}`, at: J('build', CHOREO.build.events[i]!) }));
  const logIn = progress(f, J('build', CHOREO.build.events[0]!) - 10, 16);
  const logOut = progress(f, J('shipped', CHOREO.shipped.flip), 20, EASE_IN);
  const queuedIn = progress(f, J('fills', CHOREO.fills.queue) + 20, 18) - progress(f, J('build', 0), 16);

  // ---- Shipped: the pile of real shipped cards -----------------------------------------------
  const pileT = J('shipped', CHOREO.shipped.pile);
  const pileOffsets = [
    { dx: -16, dy: 16, r: -6 },
    { dx: 12, dy: 6, r: 4 },
    { dx: -2, dy: -4, r: -2 },
  ];
  const thuds = pileOffsets.map((_, i) => pileT + i * 15);
  const jolt = [...thuds.map((t) => shake(f, t + 10, 3)), shake(f, slam, 9)].reduce((a, b) => ({ x: a.x + b.x, y: a.y + b.y }), { x: 0, y: 0 });

  return (
    <Stage format={format} shake={jolt}>
      {/* Queued, over the card while it waits */}
      {queuedIn > 0 ? (
        <div style={{ position: 'absolute', left: 0, top: 0, fontFamily: FONT, fontSize: 34, fontWeight: 700, color: C.ink, opacity: queuedIn, transform: `translateY(${(1 - queuedIn) * 16}px)` }}>
          {labels.queued}
        </div>
      ) : null}

      {/* The builder */}
      {agentIn > 0 && agentOut < 1 ? (
        <At x={agentX} y={250 - agentHop - beatHop} w={220} h={220}>
          <div style={{ transformOrigin: '50% 100%', transform: `rotate(${wobble(f, 3, 3, 60)}deg)` }}>
            <Avatar note={builder.note} size={220} />
          </div>
        </At>
      ) : null}

      {/* The agent's steps */}
      {logIn > 0 && logOut < 1 ? (
        <div style={{ position: 'absolute', left: 0, top: 470, opacity: logIn * (1 - logOut), transform: `translateY(${logOut * 20}px)` }}>
          <EventLog rows={rows} frame={f} width={560} visible={4} />
        </div>
      ) : null}

      {/* Shipped, and the pile of real shipped cards */}
      {f >= pileT ? (
        <>
          <div
            style={{
              position: 'absolute',
              left: PILE.x - 200,
              width: 400,
              textAlign: 'center',
              top: PILE.y - CARD.height / 2 - 76 + exit * 900 - settle,
              fontFamily: FONT,
              fontSize: 34,
              fontWeight: 700,
              color: C.ink,
              opacity: progress(f, pileT, 16),
            }}
          >
            {labels.shippedHeading}
          </div>
          {shipped.map((title, i) => {
            const drop = pop(f, thuds[i]!, 'snappy');
            const o = pileOffsets[i]!;
            return (
              <At key={title} x={PILE.x + o.dx} y={PILE.y + o.dy - (1 - drop) * 760 + exit * 900 - settle} w={CARD.width} h={CARD.height} rotate={o.r + (1 - drop) * 8}>
                <Card title={title} face="live" stamp={1} style={{ left: 0, top: 0 }} />
              </At>
            );
          })}
        </>
      ) : null}

      {others}

      {/* The card */}
      <At x={x} y={y} w={CARD.width} h={CARD.height} scale={s * (1 + flipLift * 0.05)} rotate={r}>
        <div style={{ width: '100%', height: '100%', transform: `perspective(1800px) rotateY(${flipAngle}deg)` }}>
          <Card title={hand[HERO]} face={face} fill={fill} meta={meta} gear={gear} stamp={stamp} pulse={pulse} style={{ left: 0, top: 0 }} />
        </div>
      </At>

      {fillCoins}
    </Stage>
  );
}
