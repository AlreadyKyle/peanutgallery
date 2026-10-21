import type { CSSProperties, ReactNode } from 'react';
import { Img, Sequence, staticFile } from 'remotion';
import { pop, progress, shake, tween, wobble } from '../anim';
import { Avatar } from '../components/Avatar';
import { Card } from '../components/Card';
import { Coin } from '../components/Coin';
import { Glyph } from '../components/Glyph';
import { Phone, PHONE } from '../components/Phone';
import { roster } from '../data';
import { C, EASE_IN, EASE_IN_OUT, EASE_OUT, FONT } from '../theme';
import { BEAT } from '../timeline';
import type { WeeklyGeometry } from './geometry';
import { agentAt, CURATOR, IsoRoom, project } from './IsoRoom';
import type { Layout } from './layout';
import type { SceneName } from './schema';

// The weekly video's pictures: the explainer's own drawn pieces (the agents, the card, the coin, the
// phone, the site's glyphs) set moving, one scene a beat, on bare paper. No browser frames and no
// screenshots: each scene acts out the change the words name, with one main movement and a pointer
// where a player would press. Every figure and title shown is real (cited in the week's file).

const W = 1040;
const H = 690;
const FADE = 16;

/**
 * The stage every scene stands on: the space to the right of the words, from under the
 * top bar to the foot of the frame, on bare paper. The scene's own 1040 by 690 space is centred on
 * it, scaled to fill.
 */
function stageOf(g: WeeklyGeometry) {
  const f = g.format;
  const top = f.bar + 48;
  const left = g.text.x + g.text.width + 64;
  const width = f.width - left - 56;
  const height = f.height - top - 48;
  const scale = Math.min((width - 24) / W, (height - 40) / H);
  return { left, top, width, height, scale };
}

/** A child placed by its centre. */
function At({ x, y, children, scale = 1, rotate = 0, opacity = 1, style }: { x: number; y: number; children: ReactNode; scale?: number; rotate?: number; opacity?: number; style?: CSSProperties }) {
  return (
    <div style={{ position: 'absolute', left: x, top: y, transform: `translate(-50%, -50%) rotate(${rotate}deg) scale(${scale})`, opacity, ...style }}>{children}</div>
  );
}

/** The play bot's pointer: a paper dot with an ink rim that dips when it presses. */
function Pointer({ x, y, press = 0, opacity = 1 }: { x: number; y: number; press?: number; opacity?: number }) {
  return (
    <At x={x} y={y} opacity={opacity} scale={1 - press * 0.25}>
      <div style={{ width: 34, height: 34, borderRadius: '50%', background: C.paper, border: `4px solid ${C.ink}`, boxSizing: 'border-box' }} />
    </At>
  );
}

/** A press at `t`: 0 to 1 and back over a few frames, and a ring that rings out. */
function press(local: number, t: number) {
  return tween(local, t, 3, 0, 1) - tween(local, t + 4, 8, 0, 1);
}
function Ripple({ x, y, local, t, colour = C.ink }: { x: number; y: number; local: number; t: number; colour?: string }) {
  const k = progress(local, t, 22);
  if (k <= 0 || k >= 1) return null;
  return (
    <At x={x} y={y} scale={0.3 + k * 0.9} opacity={1 - k}>
      <div style={{ width: 120, height: 120, borderRadius: '50%', border: `4px solid ${colour}` }} />
    </At>
  );
}

/** A pointer that glides between points, arriving 6 frames before each press. */
function glide(local: number, path: readonly { x: number; y: number; at: number }[]) {
  let x = path[0]!.x;
  let y = path[0]!.y;
  for (let i = 1; i < path.length; i++) {
    const k = progress(local, path[i]!.at - 18, 12, EASE_IN_OUT);
    x += (path[i]!.x - x) * k;
    y += (path[i]!.y - y) * k;
  }
  return { x, y };
}

const pill = (extra: CSSProperties = {}): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 14,
  padding: '16px 30px',
  border: `4px solid ${C.ink}`,
  borderRadius: 18,
  background: C.paper,
  fontFamily: FONT,
  fontSize: 34,
  fontWeight: 700,
  color: C.ink,
  whiteSpace: 'nowrap',
  ...extra,
});

/** A text field as the site draws it, with its label, filling in letter by letter. */
function Field({ label, text, dots = false, k, width = 520 }: { label: string; text: string; dots?: boolean; k: number; width?: number }) {
  const n = Math.round(text.length * Math.max(0, Math.min(1, k)));
  const shown = dots ? '•'.repeat(n) : text.slice(0, n);
  return (
    <div style={{ fontFamily: FONT, color: C.ink, width }}>
      <div style={{ fontSize: 27, fontWeight: 700, marginBottom: 10 }}>{label}</div>
      <div style={{ height: 74, boxSizing: 'border-box', border: `4px solid ${C.ink}`, borderRadius: 14, padding: '0 22px', display: 'flex', alignItems: 'center', fontSize: 32, background: C.paper, letterSpacing: dots ? '0.18em' : undefined }}>
        {shown}
        {k > 0 && k < 1.15 ? <span style={{ width: 3, height: 34, background: C.ink, marginLeft: 3, opacity: Math.floor(k * 12) % 2 === 0 ? 1 : 0.2 }} /> : null}
      </div>
    </div>
  );
}

function Button({ text, down = 0, dark = true, width }: { text: string; down?: number; dark?: boolean; width?: number }) {
  return (
    <div
      style={{
        ...pill({ justifyContent: 'center', background: dark ? C.ink : C.paper, color: dark ? C.paper : C.ink, width, boxSizing: 'border-box' }),
        transform: `translateY(${down * 4}px) scale(${1 - down * 0.04})`,
      }}
    >
      {text}
    </div>
  );
}

/** An agent that walks to and fro and hops on the beat: never asleep. */
function Walker({ note, x, y, size, local, seed, range = 70 }: { note: string; x: number; y: number; size: number; local: number; seed: number; range?: number }) {
  const period = 200 + (seed % 3) * 60;
  const dx = wobble(local, seed, range, period);
  const ahead = wobble(local + 1, seed, range, period) - dx;
  const phase = ((local + seed * 11) % BEAT) / BEAT;
  const hop = Math.abs(Math.sin(phase * Math.PI)) * 10;
  return (
    <>
      <At x={x + dx} y={y + size * 0.46}>
        <div style={{ width: size * 0.6 - hop, height: 12, borderRadius: '50%', background: C.line }} />
      </At>
      <At x={x + dx} y={y - hop}>
        <div style={{ transform: `scaleX(${ahead >= 0 ? 1 : -1}) rotate(${wobble(local, seed, 3, 40)}deg)` }}>
          <Avatar note={note} size={size} />
        </div>
      </At>
    </>
  );
}

const curator = roster.find((r) => r.title === 'Curator')!;

// ---------------------------------------------------------------------------------------------
// The scenes. `local` is frames from the beat's start; `len` is the beat's length.

function AgentsScene({ frame, local }: { frame: number; local: number }) {
  // The room itself, its agents wandering round the furniture, with a slow push in.
  const push = 1 + progress(local, 0, 240, EASE_IN_OUT) * 0.04;
  return (
    <div style={{ position: 'absolute', inset: 0, transform: `scale(${push})`, transformOrigin: '50% 55%' }}>
      <IsoRoom frame={frame} width={W} height={H} />
    </div>
  );
}

function AgentCardScene({ frame, local }: { frame: number; local: number }) {
  const T = 64;
  const start = frame - local;
  const at = project(agentAt(CURATOR, start + T).spot, W, H);
  const ptr = glide(local, [
    { x: W - 80, y: H - 60, at: 0 },
    { x: at.x, y: at.y - 26, at: T },
  ]);
  const card = pop(local, T + 4, 'snappy');
  const cx = Math.min(W - 250, Math.max(250, at.x));
  const below = at.y < 300;
  return (
    <>
      <IsoRoom frame={frame} width={W} height={H} hold={{ agent: CURATOR, from: start + T - 20 }} ring={{ agent: CURATOR, k: pop(local, T, 'snappy') }} />
      <Ripple x={at.x} y={at.y - 26} local={local} t={T} />
      <At x={cx} y={below ? at.y + 150 : at.y - 190} scale={0.7 + card * 0.3} opacity={Math.min(1, card * 1.6)}>
        <div style={{ width: 440, boxSizing: 'border-box', padding: 30, border: `4px solid ${C.ink}`, borderRadius: 24, background: C.paper, fontFamily: FONT, color: C.ink }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Avatar note={curator.note} size={60} />
            <div style={{ fontSize: 34, fontWeight: 700 }}>{curator.title}</div>
            <div style={{ marginLeft: 'auto', ...pill({ padding: '6px 14px', fontSize: 22, borderColor: C.live, color: C.live, borderWidth: 3 }) }}>Running</div>
          </div>
          {/* What is live: the site says the sorting starts later (copy.ts suggest.safety, #251). */}
          <div style={{ marginTop: 18, fontSize: 26, lineHeight: 1.35 }}>Will sort the ideas players pitch, once that work starts.</div>
        </div>
      </At>
      <Pointer x={ptr.x} y={ptr.y} press={press(local, T)} opacity={progress(local, 0, 12) * (1 - progress(local, T + 30, 16))} />
    </>
  );
}

function CuratorJoinsScene({ frame, local }: { frame: number; local: number }) {
  const T = 30;
  const join = pop(local, T, 'bouncy');
  const at = project(agentAt(CURATOR, frame).spot, W, H);
  const tag = pop(local, T + 14, 'snappy');
  return (
    <>
      <IsoRoom frame={frame} width={W} height={H} show={(i) => (i === CURATOR ? join : 1)} ring={{ agent: CURATOR, k: tag }} />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const k = progress(local, T + 2 + (i % 2) * 3, 30, EASE_OUT);
        const a = (i / 8) * Math.PI * 2;
        return k > 0 && k < 1 ? (
          <At key={i} x={at.x + Math.cos(a) * 110 * k} y={at.y - 30 + Math.sin(a) * 80 * k} opacity={1 - k} rotate={k * 120}>
            <Glyph name="spark" size={34} colour={C.coin} />
          </At>
        ) : null;
      })}
      <At x={at.x} y={at.y - 120 - (1 - tag) * 20} scale={0.6 + tag * 0.4} opacity={Math.min(1, tag * 1.6)}>
        <div style={pill({ fontSize: 28, padding: '10px 22px' })}>
          Curator <span style={{ ...pill({ padding: '4px 12px', fontSize: 20, borderColor: C.live, color: C.live, borderWidth: 3 }) }}>Running</span>
        </div>
      </At>
    </>
  );
}

function IdeaNote({ label, votes, voteK = 0, style }: { label?: string; votes?: number; voteK?: number; style?: CSSProperties }) {
  return (
    <div style={{ width: 460, height: 128, boxSizing: 'border-box', padding: '22px 28px', border: `4px solid ${C.ink}`, borderRadius: 20, background: C.paper, fontFamily: FONT, color: C.ink, display: 'flex', alignItems: 'center', gap: 20, ...style }}>
      <Glyph name="pencil" size={36} />
      <div style={{ flex: 1 }}>
        {label !== undefined ? <div style={{ fontSize: 28, fontWeight: 700 }}>{label}</div> : <div style={{ height: 16, borderRadius: 8, background: C.line, width: '86%' }} />}
        <div style={{ height: 12, borderRadius: 6, background: C.line, width: '58%', marginTop: 12 }} />
      </div>
      {votes !== undefined ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 28, fontWeight: 700, transform: `scale(${1 + 0.25 * Math.sin(Math.min(1, voteK) * Math.PI)})` }}>
          <Glyph name="thumb-up" size={32} />
        </div>
      ) : null}
    </div>
  );
}

function IdeasPitchScene({ local }: { local: number }) {
  const typed = progress(local, 14, 46, EASE_OUT);
  const send = 76;
  const fly = progress(local, send + 6, 30, EASE_IN_OUT);
  const filter = pop(local, send + 34, 'snappy');
  // The list makes room at its top, and the pitch lands there as a new idea.
  const room = progress(local, send + 4, 26, EASE_IN_OUT);
  const landed = pop(local, send + 30, 'snappy');
  return (
    <>
      {[0, 1, 2].map((i) => (
        <At key={i} x={760} y={150 + (i + room) * 140} opacity={(0.4 + 0.6 * progress(local, 4 + i * 5, 16)) * (i === 2 ? 1 - room : 1)}>
          <IdeaNote />
        </At>
      ))}
      {landed > 0 ? (
        <At x={760} y={150} scale={0.8 + landed * 0.2} opacity={Math.min(1, landed * 1.6)}>
          <IdeaNote label="Your idea" style={{ background: C.coinUp }} />
        </At>
      ) : null}
      <At x={290 + fly * 470} y={330 - fly * 180} scale={1 - fly * 0.55} opacity={1 - progress(local, send + 26, 10)} rotate={-3 + fly * 3}>
        <div style={{ width: 460, boxSizing: 'border-box', padding: 32, border: `4px solid ${C.ink}`, borderRadius: 26, background: C.paper, fontFamily: FONT, color: C.ink }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 34, fontWeight: 700 }}>
            <Glyph name="pencil" size={36} /> Pitch an idea
          </div>
          <div style={{ marginTop: 20, height: 120, border: `4px solid ${C.ink}`, borderRadius: 14, padding: 20, boxSizing: 'border-box', fontSize: 30 }}>
            {'Your idea for the game'.slice(0, Math.round(22 * typed))}
          </div>
          <div style={{ marginTop: 20 }}>
            <Button text="Send" down={press(local, send)} />
          </div>
        </div>
      </At>
      <At x={760} y={610} scale={0.6 + filter * 0.4} opacity={Math.min(1, filter * 2)}>
        <div style={pill({ borderColor: C.live, color: C.live })}>
          <Glyph name="check" size={32} colour={C.live} /> Passed the content filter
        </div>
      </At>
    </>
  );
}

function IdeasVoteScene({ local }: { local: number }) {
  const taps = [24, 46, 64];
  const ptr = glide(local, [
    { x: 980, y: 640, at: 0 },
    { x: 715, y: 180, at: taps[0]! },
    { x: 715, y: 320, at: taps[1]! },
    { x: 715, y: 180, at: taps[2]! },
  ]);
  const promote = progress(local, 96, 28, EASE_IN_OUT);
  const card = pop(local, 108, 'snappy');
  return (
    <>
      {[0, 1, 2].map((i) => {
        const tapK = taps.map((t, j) => ((j === 1 ? 1 : 0) === i || (j !== 1 && i === 0) ? progress(local, t, 14) : 0)).reduce((a, b) => Math.max(a, b), 0);
        const lift = i === 0 ? promote : 0;
        return (
          <At key={i} x={420 - lift * 120 - promote * 160} y={180 + i * 140 - lift * 20} opacity={1 - promote}>
            <IdeaNote votes={1} voteK={tapK} />
          </At>
        );
      })}
      <Pointer x={ptr.x} y={ptr.y} press={taps.reduce((s, t) => s + press(local, t), 0)} opacity={progress(local, 0, 10) * (1 - progress(local, 80, 14))} />
      {card > 0 ? (
        <At x={W / 2} y={345} scale={(0.7 + card * 0.3) * 1.2} opacity={Math.min(1, card * 1.5)} rotate={(1 - card) * -6}>
          <div style={{ position: 'relative', width: 520, height: 330 }}>
            <Card title="The most backed idea becomes a card" face="open" fill={progress(local, 120, 40) * 0.35} meta="Suggested by a player" />
          </div>
        </At>
      ) : null}
    </>
  );
}

function SignupScene({ local }: { local: number }) {
  const email = progress(local, 10, 36);
  const pass = progress(local, 50, 26);
  const T = 88;
  const ptr = glide(local, [
    { x: 960, y: 640, at: 0 },
    { x: 520, y: 470, at: T },
  ]);
  const providers = pop(local, T + 16, 'snappy');
  return (
    <>
      <At x={420} y={320}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Field label="Email" text="you@example.com" k={email} />
          <Field label="Password" text="password12" dots k={pass} />
          <Button text="Create account" down={press(local, T)} width={520} />
        </div>
      </At>
      <Ripple x={520} y={470} local={local} t={T} colour={C.paper} />
      <At x={840} y={240} opacity={Math.min(1, providers * 1.6)} scale={0.7 + providers * 0.3}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'stretch' }}>
          <div style={{ fontFamily: FONT, fontSize: 24, color: C.muted, textAlign: 'center' }}>or</div>
          <div style={pill()}>Continue with Google</div>
          <div style={pill({ transform: `translateY(${(1 - pop(local, T + 22, 'snappy')) * 30}px)` })}>Continue with GitHub</div>
        </div>
      </At>
      <Pointer x={ptr.x} y={ptr.y} press={press(local, T)} opacity={progress(local, 50, 12) * (1 - progress(local, T + 24, 14))} />
    </>
  );
}

function ResetScene({ local }: { local: number }) {
  const T = 52;
  const fly = progress(local, T + 6, 40, EASE_IN_OUT);
  const inbox = pop(local, T + 40, 'snappy');
  const fresh = progress(local, T + 70, 34);
  const ptr = glide(local, [
    { x: 900, y: 620, at: 0 },
    { x: 330, y: 360, at: T },
  ]);
  return (
    <>
      <At x={330} y={300}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Field label="Email" text="you@example.com" k={progress(local, 6, 30)} width={440} />
          <Button text="Send reset link" down={press(local, T)} width={440} />
        </div>
      </At>
      <At x={360 + fly * 420} y={380 - Math.sin(fly * Math.PI) * 200 - fly * 120} rotate={-20 + fly * 30} opacity={fly > 0 && fly < 1 ? 1 : 0}>
        <Glyph name="plane" size={64} />
      </At>
      <At x={790} y={250} scale={0.6 + inbox * 0.4} opacity={Math.min(1, inbox * 1.6)}>
        <div style={pill()}>
          <Glyph name="plane" size={30} /> Check your email
        </div>
      </At>
      <At x={790} y={430} opacity={fresh}>
        <Field label="New password" text="newpassword" dots k={progress(local, T + 76, 30)} width={400} />
      </At>
      <Pointer x={ptr.x} y={ptr.y} press={press(local, T)} opacity={progress(local, 0, 10) * (1 - progress(local, T + 20, 14))} />
    </>
  );
}

// A card that shipped this week's run up: its title as the ledger lists it.
const FOLLOWED = 'Make the Gatherer collect dust faster, from 0.2 to 0.25 dust per second';

function FollowScene({ local, len }: { local: number; len: number }) {
  const T = 40;
  const ship = Math.round(len * 0.55);
  const stamp = progress(local, ship, 14, EASE_IN);
  const s = shake(local, ship + 14, 8);
  const note = pop(local, ship + 30, 'snappy');
  const ptr = glide(local, [
    { x: 940, y: 640, at: 0 },
    { x: 360, y: 540, at: T },
  ]);
  const following = local >= T;
  return (
    <>
      <div style={{ position: 'absolute', left: 70 + s.x, top: 60 + s.y, width: 520, height: 330, transform: 'scale(1.12)', transformOrigin: 'top left' }}>
        <Card title={FOLLOWED} face={local >= ship ? 'live' : 'building'} fill={0.999} stamp={stamp} gear={local * 4} meta={local >= ship ? null : 'Builder A is building this'} />
      </div>
      <At x={360} y={540}>
        <div style={{ ...pill({ background: following ? C.ink : C.paper, color: following ? C.paper : C.ink }), transform: `scale(${1 - press(local, T) * 0.05})` }}>
          <Glyph name="flag" size={30} colour={following ? C.paper : C.ink} /> {following ? 'Following' : 'Tell me when this ships'}
        </div>
      </At>
      <At x={850} y={300 - (1 - note) * 60} scale={0.6 + note * 0.4} opacity={Math.min(1, note * 1.6)}>
        <div style={{ width: 320, boxSizing: 'border-box', padding: 26, border: `4px solid ${C.ink}`, borderRadius: 22, background: C.paper, fontFamily: FONT, color: C.ink }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 28, fontWeight: 700 }}>
            <Glyph name="plane" size={30} /> It shipped
          </div>
          <div style={{ marginTop: 10, fontSize: 22, color: C.muted }}>An email to everyone who follows the card</div>
        </div>
      </At>
      <Pointer x={ptr.x} y={ptr.y} press={press(local, T)} opacity={progress(local, 0, 10) * (1 - progress(local, T + 20, 14))} />
    </>
  );
}

function DustScene({ local }: { local: number }) {
  const taps = [
    { at: 34, button: 'strike' as const },
    { at: 56, button: 'strike' as const },
    { at: 78, button: 'buyGatherer' as const },
    { at: 108, button: 'strike' as const },
  ];
  const phone = pop(local, 2, 'soft');
  const art = pop(local, 14, 'bouncy');
  const turn = wobble(local, 3, 14, 150);
  return (
    <>
      <At x={300} y={350 + (1 - phone) * 80} opacity={Math.min(1, phone * 1.4)}>
        <div style={{ position: 'relative', width: PHONE.width, height: PHONE.height }}>
          <Phone frame={local} taps={taps} />
        </div>
      </At>
      {taps.map((tap, i) => {
        const k = progress(local, tap.at, 34, EASE_OUT);
        return k > 0 && k < 1 ? (
          <At key={i} x={300 + (i % 2 ? 1 : -1) * (150 + k * 70)} y={260 - k * 130} opacity={1 - k} rotate={k * 140}>
            <Glyph name="spark" size={48} colour={C.coin} />
          </At>
        ) : null;
      })}
      <At x={730} y={330 + (1 - art) * 120} opacity={Math.min(1, art * 1.5)} scale={0.8 + art * 0.2}>
        <div style={{ perspective: 1200 }}>
          <div style={{ transform: `rotateY(${-18 + turn}deg) rotateX(${6 + wobble(local, 5, 3, 120)}deg)`, transformStyle: 'preserve-3d' }}>
            <Img src={staticFile('box-art.svg')} style={{ width: 330, height: 440, display: 'block', borderRadius: 18, border: `5px solid ${C.ink}` }} />
          </div>
        </div>
      </At>
      <At x={730} y={600} opacity={progress(local, 40, 16)} scale={0.85 + 0.15 * pop(local, 40, 'snappy')} rotate={-3}>
        <div style={pill({ background: C.suitGame, color: C.paper })}>Now in 3D</div>
      </At>
    </>
  );
}

function DailyScene({ local, len }: { local: number; len: number }) {
  const end = Math.round(len * 0.5);
  const run = progress(local, 10, end - 10, EASE_IN_OUT);
  const done = pop(local, end + 4, 'bouncy');
  const secs = Math.round(240 * (1 - run));
  const r = 160;
  const circ = 2 * Math.PI * r;
  const ringBump = 1 + 0.06 * Math.sin(Math.min(1, progress(local, end, 14)) * Math.PI);
  return (
    <>
      <At x={300} y={345} scale={ringBump}>
        <svg width={380} height={380} viewBox="0 0 380 380" style={{ overflow: 'visible' }}>
          <circle cx={190} cy={190} r={r} fill={C.paper} stroke={C.line} strokeWidth={22} />
          <circle cx={190} cy={190} r={r} fill="none" stroke={C.coin} strokeWidth={22} strokeDasharray={circ} strokeDashoffset={circ * run} transform="rotate(-90 190 190)" strokeLinecap="round" />
          <circle cx={190} cy={190} r={r + 15} fill="none" stroke={C.ink} strokeWidth={5} />
          <circle cx={190} cy={190} r={r - 15} fill="none" stroke={C.ink} strokeWidth={5} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontFamily: FONT, color: C.ink }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 84, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`}</div>
            <div style={{ fontSize: 26, color: C.muted, fontWeight: 600 }}>Today's run</div>
          </div>
        </div>
      </At>
      <At x={760} y={345 + (1 - done) * 60} scale={0.7 + done * 0.3} opacity={Math.min(1, done * 1.6)} rotate={(1 - done) * 10 - 2}>
        <div style={{ width: 400, boxSizing: 'border-box', padding: 32, border: `4px solid ${C.ink}`, borderRadius: 26, background: C.paper, fontFamily: FONT, color: C.ink }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 34, fontWeight: 700 }}>Daily Dust</div>
            <span style={{ display: 'inline-grid', placeItems: 'center', width: 40, height: 40, borderRadius: 9, background: C.suitGame, color: C.paper }}>
              <Glyph name="cartridge" size={26} />
            </span>
          </div>
          <div style={{ display: 'flex', gap: 9, margin: '24px 0', alignItems: 'flex-end', height: 110 }}>
            {[0.3, 0.45, 0.4, 0.6, 0.7, 0.65, 0.85, 1].map((h, i) => (
              <div key={i} style={{ flex: 1, height: `${h * 100 * progress(local, end + 10 + i * 3, 14)}%`, background: i === 7 ? C.suitGame : C.ink, borderRadius: 5 }} />
            ))}
          </div>
          <div style={{ fontSize: 24, color: C.muted }}>The same run for everyone, every day</div>
        </div>
      </At>
    </>
  );
}

function SeedScene({ local }: { local: number }) {
  const out = 30;
  const players = [
    { x: 760, y: 150 },
    { x: 880, y: 340 },
    { x: 760, y: 530 },
  ];
  return (
    <>
      <At x={260} y={350} scale={0.86}>
        <div style={{ position: 'relative', width: PHONE.width, height: PHONE.height }}>
          <Phone frame={local} taps={[{ at: 22, button: 'strike' }]} />
        </div>
      </At>
      <At x={260} y={60} opacity={progress(local, 18, 12)}>
        <div style={pill({ fontSize: 24, padding: '8px 18px' })}>
          <Glyph name="seed" size={26} /> Save as seed
        </div>
      </At>
      {players.map((p, i) => {
        const t = out + i * 14;
        const k = progress(local, t, 34, EASE_IN_OUT);
        const land = pop(local, t + 34, 'bouncy');
        const sx = 360 + (p.x - 360) * k;
        const sy = 330 + (p.y - 330) * k - Math.sin(k * Math.PI) * 140;
        return (
          <div key={i}>
            {k > 0 && k < 1 ? (
              <At x={sx} y={sy} rotate={k * 360}>
                <Glyph name="seed" size={46} colour={C.live} />
              </At>
            ) : null}
            <At x={p.x} y={p.y} scale={0.85 + land * 0.15}>
              <div style={{ ...pill({ background: land > 0.5 ? C.ink : C.paper, color: land > 0.5 ? C.paper : C.ink, fontSize: 26 }) }}>
                <Glyph name="play" size={26} colour={land > 0.5 ? C.paper : C.ink} /> {land > 0.5 ? 'Playing on' : 'Open the seed'}
              </div>
            </At>
          </div>
        );
      })}
    </>
  );
}

function RatesScene({ local }: { local: number }) {
  const flip = progress(local, 30, 22, EASE_IN_OUT);
  const land = pop(local, 30, 'bouncy');
  return (
    <At x={W / 2} y={345}>
      <div style={{ width: 720, boxSizing: 'border-box', padding: '40px 48px', border: `4px solid ${C.ink}`, borderRadius: 30, background: C.paper, fontFamily: FONT, color: C.ink }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 38, fontWeight: 700 }}>
          <Glyph name="team" size={40} /> Gatherer
          <span style={{ marginLeft: 'auto', fontSize: 26, color: C.muted, fontWeight: 600 }}>per second</span>
        </div>
        <div style={{ position: 'relative', height: 190, overflow: 'hidden', marginTop: 16 }}>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', fontSize: 168, fontWeight: 700, transform: `translateY(${-flip * 100}%)`, opacity: 1 - flip, color: C.muted }}>+0.3</div>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', fontSize: 168, fontWeight: 700, transform: `translateY(${(1 - flip) * 100}%) scale(${0.96 + 0.04 * land})`, transformOrigin: 'left center' }}>+0.25</div>
        </div>
      </div>
    </At>
  );
}

function LedgerScene({ local }: { local: number }) {
  const jars = ['In the pool', 'On card bars', 'In reserve'];
  return (
    <>
      {jars.map((label, i) => {
        const x = 220 + i * 300;
        const fill = progress(local, 14 + i * 10, 40, EASE_OUT) * (0.45 + i * 0.15);
        return (
          <div key={label}>
            {[0, 1, 2].map((c) => {
              const t = 6 + i * 10 + c * 8;
              const k = progress(local, t, 22, EASE_IN);
              return k > 0 && k < 1 ? <Coin key={c} size={56} x={x + (c - 1) * 20} y={60 + k * 300} turn={Math.cos(k * 9)} /> : null;
            })}
            <div style={{ position: 'absolute', left: x - 90, top: 260, width: 180, height: 260, boxSizing: 'border-box', border: `4px solid ${C.ink}`, borderRadius: 22, overflow: 'hidden', background: C.paper }}>
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${fill * 100}%`, background: C.coin, borderTop: `3px solid ${C.ink}` }} />
            </div>
            <At x={x} y={560}>
              <div style={{ fontFamily: FONT, fontSize: 26, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap' }}>{label}</div>
            </At>
          </div>
        );
      })}
      <At x={W / 2} y={630} scale={0.6 + pop(local, 70, 'snappy') * 0.4} opacity={progress(local, 70, 10)}>
        <div style={pill({ borderColor: C.live, color: C.live })}>
          <Glyph name="check" size={30} colour={C.live} /> Every line adds up
        </div>
      </At>
    </>
  );
}

function TermsScene({ local }: { local: number }) {
  const stamp = progress(local, 30, 14, EASE_IN);
  const s = shake(local, 44, 6);
  return (
    <>
      <At x={W / 2 + s.x} y={330 + s.y}>
        <div style={{ width: 420, height: 520, boxSizing: 'border-box', padding: 40, border: `4px solid ${C.ink}`, borderRadius: 24, background: C.paper, fontFamily: FONT, color: C.ink }}>
          <div style={{ fontSize: 40, fontWeight: 700 }}>Terms</div>
          {[0.9, 0.75, 0.85, 0.6, 0.8, 0.7, 0.5].map((w, i) => (
            <div key={i} style={{ height: 14, borderRadius: 7, background: C.line, width: `${w * 100}%`, marginTop: i === 0 ? 30 : 18 }} />
          ))}
        </div>
      </At>
      <At x={W / 2 + 120} y={430} rotate={-8 - (1 - stamp) * 10} scale={1 + (1 - stamp) * 1.4} opacity={Math.min(1, stamp * 3)}>
        <div style={pill({ borderColor: C.live, color: C.live, fontSize: 34 })}>Version 4</div>
      </At>
    </>
  );
}

function CheckoutScene({ local }: { local: number }) {
  return (
    <div style={{ position: 'absolute', inset: 0, transform: 'scale(1.18)', transformOrigin: '45% 50%' }}>
      <CheckoutInner local={local} />
    </div>
  );
}

function CheckoutInner({ local }: { local: number }) {
  const chips = ['$5', '$10', '$25', '$50', '$100'];
  const T = 34;
  const picked = local >= T;
  const ptr = glide(local, [
    { x: 900, y: 600, at: 0 },
    { x: 230 + 150, y: 200, at: T },
  ]);
  const coin = progress(local, T + 16, 30, EASE_IN);
  const box2 = pop(local, T + 44, 'snappy');
  return (
    <>
      <div style={{ position: 'absolute', left: 80, top: 160, display: 'flex', gap: 14 }}>
        {chips.map((c, i) => {
          const on = picked && i === 1;
          return (
            <div key={c} style={{ ...pill({ background: on ? C.ink : C.paper, color: on ? C.paper : C.ink, padding: '14px 22px' }), transform: `scale(${on ? 1 - press(local, T) * 0.06 : 1})` }}>
              {c}
            </div>
          );
        })}
      </div>
      <div style={{ position: 'absolute', left: 80, top: 280 }}>
        <Button text={picked ? 'Fund $10' : 'Fund $5'} />
      </div>
      {coin > 0 && coin < 1 ? <Coin size={70} x={240 + coin * 520} y={320 + Math.sin(coin * Math.PI) * -120 + coin * 120} turn={Math.cos(coin * 10)} /> : null}
      <At x={780} y={460} scale={0.6 + box2 * 0.4} opacity={Math.min(1, box2 * 1.6)}>
        <div style={{ width: 360, boxSizing: 'border-box', padding: 30, border: `4px solid ${C.ink}`, borderRadius: 24, background: C.paper, fontFamily: FONT, color: C.ink }}>
          <div style={{ fontSize: 24, color: C.muted, fontWeight: 600 }}>Checkout</div>
          <div style={{ fontSize: 72, fontWeight: 700, marginTop: 8 }}>$10.00</div>
        </div>
      </At>
      <Pointer x={ptr.x} y={ptr.y} press={press(local, T)} opacity={progress(local, 0, 10) * (1 - progress(local, T + 20, 12))} />
    </>
  );
}

function ShieldScene({ local }: { local: number }) {
  const draw = progress(local, 6, 30, EASE_OUT);
  const tick = progress(local, 30, 16, EASE_OUT);
  return (
    <At x={W / 2} y={330} scale={0.9 + 0.1 * pop(local, 0, 'soft')}>
      <svg width={360} height={420} viewBox="0 0 360 420" style={{ overflow: 'visible' }}>
        <path d="M180 20 L320 70 V200 C320 300 250 370 180 400 C110 370 40 300 40 200 V70 Z" fill={C.work} stroke={C.ink} strokeWidth={10} strokeLinejoin="round" strokeDasharray={1200} strokeDashoffset={1200 * (1 - draw)} />
        <path d="M115 215 L165 265 L255 165" fill="none" stroke={C.ink} strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={260} strokeDashoffset={260 * (1 - tick)} />
      </svg>
    </At>
  );
}

function FastScene({ local }: { local: number }) {
  return (
    <>
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const k = pop(local, 4 + i * 5, 'snappy');
        const x = 300 + (i % 3) * 220;
        const y = 220 + Math.floor(i / 3) * 220;
        return (
          <At key={i} x={x + (1 - k) * (i % 2 ? 300 : -300)} y={y} opacity={Math.min(1, k * 2)} rotate={(1 - k) * 20}>
            <div style={{ width: 190, height: 190, boxSizing: 'border-box', border: `4px solid ${C.ink}`, borderRadius: 22, background: i === 5 ? C.coin : C.paper, display: 'grid', placeItems: 'center' }}>
              {i === 5 ? <Glyph name="check" size={70} /> : <div style={{ width: 90, height: 14, borderRadius: 7, background: C.line }} />}
            </div>
          </At>
        );
      })}
    </>
  );
}

function EmailScene({ local }: { local: number }) {
  const fly = progress(local, 8, 36, EASE_IN_OUT);
  const mail = pop(local, 40, 'snappy');
  return (
    <>
      {fly < 1 ? (
        <At x={120 + fly * 420} y={520 - Math.sin(fly * Math.PI) * 260 - fly * 140} rotate={-25 + fly * 35}>
          <Glyph name="plane" size={80} />
        </At>
      ) : null}
      <At x={620} y={330} scale={0.6 + mail * 0.4} opacity={Math.min(1, mail * 1.6)}>
        <div style={{ width: 700, boxSizing: 'border-box', padding: 42, border: `4px solid ${C.ink}`, borderRadius: 30, background: C.paper, fontFamily: FONT, color: C.ink }}>
          <div style={{ fontSize: 27, color: C.muted, fontWeight: 600 }}>From studio@mobmachine.games</div>
          <div style={{ fontSize: 46, fontWeight: 700, marginTop: 12 }}>Shipped in Dust</div>
          <div style={{ marginTop: 26, padding: 22, border: `4px solid ${C.ink}`, borderRadius: 16, background: C.coinUp, fontSize: 30, fontWeight: 600, opacity: progress(local, 60, 16), transform: `translateY(${(1 - progress(local, 60, 16)) * 16}px)` }}>
            Next for Dust: the next card to fund
          </div>
        </div>
      </At>
    </>
  );
}

function SocialScene({ local }: { local: number }) {
  const names = ['Bluesky', 'Mastodon', 'Discord'];
  return (
    <>
      <At x={180} y={340} scale={0.9 + 0.1 * pop(local, 0, 'soft')}>
        <div style={{ width: 240, height: 240, borderRadius: 36, border: `5px solid ${C.ink}`, display: 'grid', placeItems: 'center', background: C.coinUp }}>
          <Glyph name="flag" size={110} />
        </div>
      </At>
      {names.map((n, i) => {
        const t = 16 + i * 10;
        const k = progress(local, t, 30, EASE_IN_OUT);
        const land = pop(local, t + 30, 'bouncy');
        const ty = 150 + i * 190;
        return (
          <div key={n}>
            {k > 0 && k < 1 ? (
              <At x={300 + k * 380} y={340 + (ty - 340) * k - Math.sin(k * Math.PI) * 60} rotate={-10 + k * 10}>
                <Glyph name="plane" size={52} />
              </At>
            ) : null}
            <At x={780} y={ty} scale={0.6 + land * 0.4} opacity={Math.min(1, land * 1.6)}>
              <div style={pill({ width: 340, justifyContent: 'center', fontSize: 38, padding: '20px 30px' })}>{n}</div>
            </At>
          </div>
        );
      })}
    </>
  );
}

const SCENES: Record<SceneName, (p: { frame: number; local: number; len: number }) => ReactNode> = {
  agents: AgentsScene,
  'agent-card': AgentCardScene,
  'curator-joins': CuratorJoinsScene,
  'ideas-pitch': IdeasPitchScene,
  'ideas-vote': IdeasVoteScene,
  signup: SignupScene,
  reset: ResetScene,
  follow: FollowScene,
  dust: DustScene,
  daily: DailyScene,
  seed: SeedScene,
  rates: RatesScene,
  ledger: LedgerScene,
  terms: TermsScene,
  checkout: CheckoutScene,
  shield: ShieldScene,
  fast: FastScene,
  email: EmailScene,
  social: SocialScene,
};

/** Every beat's scene on the stage, cross-faded on the beat's first frames. */
export function Scenes({ frame, g, plan }: { frame: number; g: WeeklyGeometry; plan: Layout }) {
  const st = stageOf(g);
  const first = plan.beats[0]!.start;
  const enter = pop(frame, first - 8, 'soft');
  const exit = progress(frame, plan.outro - 30, 30, EASE_IN);
  const ox = (st.width - W * st.scale) / 2;
  const oy = (st.height - H * st.scale) / 2;
  return (
    <div
      style={{
        position: 'absolute',
        left: st.left,
        top: st.top,
        width: st.width,
        height: st.height,
        opacity: Math.min(1, enter * 1.3) * (1 - exit),
        transform: `translateY(${(1 - enter) * 50 + exit * 40}px) scale(${0.96 + enter * 0.04})`,
      }}
    >
      <div style={{ position: 'absolute', left: ox, top: oy, width: W, height: H, transform: `scale(${st.scale})`, transformOrigin: 'top left' }}>
        {plan.beats.map((placed, i) => {
          const shot = placed.beat.shot;
          if (!('scene' in shot)) return null;
          const Scene = SCENES[shot.scene];
          const next = plan.beats[i + 1];
          const end = next === undefined ? plan.outro : next.start;
          return (
            <Sequence key={i} from={placed.start} durationInFrames={end - placed.start + FADE} layout="none">
              <SceneLayer frame={frame} start={placed.start} end={end} last={next === undefined}>
                <Scene frame={frame} local={frame - placed.start} len={end - placed.start} />
              </SceneLayer>
            </Sequence>
          );
        })}
      </div>
    </div>
  );
}

function SceneLayer({ frame, start, end, last, children }: { frame: number; start: number; end: number; last: boolean; children: ReactNode }) {
  const inK = progress(frame, start, FADE, EASE_OUT);
  const outK = last ? 0 : progress(frame, end, FADE, EASE_IN);
  return (
    <div style={{ position: 'absolute', inset: 0, opacity: inK * (1 - outK), transform: `translateY(${(1 - inK) * 24 - outK * 24}px)` }}>{children}</div>
  );
}
