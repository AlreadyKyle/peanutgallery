import type { CSSProperties, ReactNode } from 'react';
import { Sequence } from 'remotion';
import { pop, progress, shake, tween, wobble } from '../anim';
import { Avatar } from '../components/Avatar';
import { Card } from '../components/Card';
import { Coin } from '../components/Coin';
import { Glyph } from '../components/Glyph';
import { Phone, PHONE } from '../components/Phone';
import { roster } from '../data';
import { C, EASE_IN, EASE_IN_OUT, EASE_OUT, FONT } from '../theme';
import { BEAT } from '../timeline';
import { frameHeight, type WeeklyGeometry } from './geometry';
import type { Layout } from './layout';
import type { SceneName } from './schema';

// The weekly video's pictures: the explainer's own drawn pieces (the agents, the card, the coin, the
// phone, the site's glyphs) set moving, one scene a beat, on bare paper. No browser frames and no
// screenshots: each scene acts out the change the words name, with one main movement and a pointer
// where a player would press. Every figure and title shown is real (cited in the week's file).

const W = 1040;
const FADE = 16;

const box = (g: WeeklyGeometry) => ({ x: g.frame.x, y: g.frame.y, width: W, height: frameHeight(g) });

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
  padding: '14px 26px',
  border: `4px solid ${C.ink}`,
  borderRadius: 18,
  background: C.paper,
  fontFamily: FONT,
  fontSize: 30,
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
      <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 10 }}>{label}</div>
      <div style={{ height: 66, boxSizing: 'border-box', border: `3px solid ${C.ink}`, borderRadius: 12, padding: '0 20px', display: 'flex', alignItems: 'center', fontSize: 28, letterSpacing: dots ? '0.18em' : undefined }}>
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

function AgentsScene({ local }: { local: number }) {
  const rows = [roster.slice(0, 5), roster.slice(5)];
  return (
    <>
      {rows.map((row, r) =>
        row.map((agent, i) => {
          const n = r * 5 + i;
          const up = pop(local, 4 + n * 4, 'bouncy');
          const x = 130 + i * 195 + (r === 1 ? 97 : 0);
          const y = 210 + r * 250;
          return (
            <div key={agent.title} style={{ opacity: Math.min(1, up * 1.5), transform: `scale(${0.6 + up * 0.4})`, transformOrigin: `${x}px ${y}px`, position: 'absolute', inset: 0 }}>
              <Walker note={agent.note} x={x} y={y} size={150} local={local} seed={n} range={55} />
            </div>
          );
        }),
      )}
      <At x={W / 2} y={640} opacity={progress(local, 50, 20)}>
        <div style={{ fontFamily: FONT, fontSize: 26, fontWeight: 600, color: C.muted }}>Nine agents, all running</div>
      </At>
    </>
  );
}

function AgentCardScene({ local }: { local: number }) {
  const T = 70;
  const ptr = glide(local, [
    { x: 900, y: 600, at: 0 },
    { x: 330, y: 360, at: T },
  ]);
  const card = pop(local, T + 4, 'snappy');
  return (
    <>
      <Walker note={curator.note} x={330} y={330} size={260} local={local} seed={8} range={Math.max(0, 40 * (1 - progress(local, T - 30, 20)))} />
      <Ripple x={330} y={330} local={local} t={T} />
      <At x={720} y={330} scale={0.7 + card * 0.3} opacity={Math.min(1, card * 1.6)}>
        <div style={{ width: 460, boxSizing: 'border-box', padding: 34, border: `4px solid ${C.ink}`, borderRadius: 26, background: C.paper, fontFamily: FONT, color: C.ink }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Avatar note={curator.note} size={64} />
            <div style={{ fontSize: 36, fontWeight: 700 }}>{curator.title}</div>
          </div>
          <div style={{ marginTop: 18, display: 'inline-flex', ...pill({ padding: '6px 16px', fontSize: 22, borderColor: C.live, color: C.live, borderWidth: 3 }) }}>Running</div>
          <div style={{ marginTop: 20, fontSize: 26, lineHeight: 1.35 }}>Reads the ideas players pitch and sorts them into clear summaries.</div>
        </div>
      </At>
      <Pointer x={ptr.x} y={ptr.y} press={press(local, T)} opacity={progress(local, 0, 12) * (1 - progress(local, T + 30, 16))} />
    </>
  );
}

function CuratorJoinsScene({ local }: { local: number }) {
  const team = roster.filter((r) => r.title !== 'Curator');
  const join = pop(local, 40, 'bouncy');
  return (
    <>
      {team.map((agent, i) => {
        const x = 150 + (i % 4) * 245;
        const y = 170 + Math.floor(i / 4) * 230;
        const make = 0.92 + 0.08 * (1 - progress(local, 40, 30));
        return (
          <At key={agent.title} x={x} y={y - Math.abs(Math.sin((((local + i * 9) % BEAT) / BEAT) * Math.PI)) * 6} scale={make}>
            <Avatar note={agent.note} size={130} />
          </At>
        );
      })}
      <At x={W / 2} y={560 - (1 - join) * 220} scale={0.4 + join * 0.6} opacity={Math.min(1, join * 2)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Avatar note={curator.note} size={170} />
          <div style={{ fontFamily: FONT, color: C.ink }}>
            <div style={{ fontSize: 40, fontWeight: 700 }}>Curator</div>
            <div style={{ ...pill({ padding: '6px 16px', fontSize: 22, borderColor: C.live, color: C.live, borderWidth: 3 }), marginTop: 8 }}>Running</div>
          </div>
        </div>
      </At>
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const k = progress(local, 44 + i, 26, EASE_OUT);
        const a = (i / 6) * Math.PI * 2;
        return k > 0 && k < 1 ? (
          <At key={i} x={W / 2 - 90 + Math.cos(a) * 150 * k} y={560 + Math.sin(a) * 110 * k} opacity={1 - k} rotate={k * 90}>
            <Glyph name="spark" size={40} colour={C.coin} />
          </At>
        ) : null;
      })}
    </>
  );
}

/** An idea note: a card with the pencil, a line of grey for its words, and a vote count. */
function IdeaNote({ label, votes, voteK = 0, style }: { label?: string; votes?: number; voteK?: number; style?: CSSProperties }) {
  return (
    <div style={{ width: 420, height: 120, boxSizing: 'border-box', padding: '22px 26px', border: `4px solid ${C.ink}`, borderRadius: 20, background: C.paper, fontFamily: FONT, color: C.ink, display: 'flex', alignItems: 'center', gap: 20, ...style }}>
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
  const filter = pop(local, send + 20, 'snappy');
  const filterOut = progress(local, send + 50, 14);
  return (
    <>
      {[0, 1, 2].map((i) => (
        <At key={i} x={760} y={210 + i * 140} opacity={0.35 + 0.65 * progress(local, 4 + i * 5, 16)}>
          <IdeaNote />
        </At>
      ))}
      <At x={300 + fly * 460} y={330 - fly * 260} scale={1 - fly * 0.0} rotate={-4 + fly * 4}>
        <div style={{ width: 440, boxSizing: 'border-box', padding: 30, border: `4px solid ${C.ink}`, borderRadius: 24, background: C.paper, fontFamily: FONT, color: C.ink, boxShadow: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 30, fontWeight: 700 }}>
            <Glyph name="pencil" size={34} /> Pitch an idea
          </div>
          <div style={{ marginTop: 20, height: 110, border: `3px solid ${C.ink}`, borderRadius: 12, padding: 18, boxSizing: 'border-box', fontSize: 26 }}>
            {'Your idea for the game'.slice(0, Math.round(22 * typed))}
          </div>
          <div style={{ marginTop: 18 }}>
            <Button text="Send" down={press(local, send)} />
          </div>
        </div>
      </At>
      <At x={760} y={600} scale={0.6 + filter * 0.4} opacity={Math.min(1, filter * 2) * (1 - filterOut)}>
        <div style={pill({ borderColor: C.live, color: C.live })}>
          <Glyph name="check" size={30} colour={C.live} /> Passed the content filter
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
          <At key={i} x={420 - lift * 120} y={180 + i * 140 - lift * 20} opacity={i === 0 ? 1 - promote : 1 - promote * 0.5}>
            <IdeaNote votes={1} voteK={tapK} />
          </At>
        );
      })}
      <Pointer x={ptr.x} y={ptr.y} press={taps.reduce((s, t) => s + press(local, t), 0)} opacity={progress(local, 0, 10) * (1 - progress(local, 80, 14))} />
      {card > 0 ? (
        <At x={W / 2} y={340} scale={0.7 + card * 0.3} opacity={Math.min(1, card * 1.5)}>
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
      <div style={{ position: 'absolute', left: 100 + s.x, top: 90 + s.y, width: 520, height: 330 }}>
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
    { at: 30, button: 'strike' as const },
    { at: 52, button: 'strike' as const },
    { at: 74, button: 'buyGatherer' as const },
    { at: 104, button: 'strike' as const },
  ];
  const up = pop(local, 2, 'soft');
  return (
    <>
      <At x={W / 2} y={360 + (1 - up) * 80} opacity={Math.min(1, up * 1.4)} scale={0.86}>
        <div style={{ position: 'relative', width: PHONE.width, height: PHONE.height }}>
          <Phone frame={local} taps={taps} />
        </div>
      </At>
      {[0, 1, 2, 3].map((i) => {
        const t = taps[i]!.at;
        const k = progress(local, t, 34, EASE_OUT);
        return k > 0 && k < 1 ? (
          <At key={i} x={W / 2 + (i % 2 ? 1 : -1) * (180 + k * 60)} y={300 - k * 120} opacity={1 - k} rotate={k * 120}>
            <Glyph name="spark" size={44} colour={C.coin} />
          </At>
        ) : null;
      })}
      <At x={W / 2 + 290} y={180} opacity={progress(local, 20, 16)} rotate={-6}>
        <div style={pill({ background: C.suitGame, color: C.paper, borderColor: C.ink })}>Now in 3D</div>
      </At>
    </>
  );
}

function DailyScene({ local, len }: { local: number; len: number }) {
  const run = progress(local, 16, len - 50, EASE_IN_OUT);
  const done = pop(local, len - 34, 'snappy');
  const secs = Math.round(240 * (1 - run));
  const r = 150;
  const circ = 2 * Math.PI * r;
  return (
    <>
      <At x={360} y={330}>
        <svg width={360} height={360} viewBox="0 0 360 360" style={{ overflow: 'visible' }}>
          <circle cx={180} cy={180} r={r} fill={C.paper} stroke={C.line} strokeWidth={18} />
          <circle cx={180} cy={180} r={r} fill="none" stroke={C.coin} strokeWidth={18} strokeDasharray={circ} strokeDashoffset={circ * run} transform="rotate(-90 180 180)" strokeLinecap="round" />
          <circle cx={180} cy={180} r={r + 12} fill="none" stroke={C.ink} strokeWidth={4} />
          <circle cx={180} cy={180} r={r - 12} fill="none" stroke={C.ink} strokeWidth={4} />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontFamily: FONT, color: C.ink }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 76, fontWeight: 700 }}>{`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`}</div>
            <div style={{ fontSize: 24, color: C.muted, fontWeight: 600 }}>Today's run</div>
          </div>
        </div>
      </At>
      <At x={790} y={330} scale={0.6 + done * 0.4} opacity={Math.min(1, done * 1.6)} rotate={(1 - done) * 8}>
        <div style={{ width: 360, boxSizing: 'border-box', padding: 28, border: `4px solid ${C.ink}`, borderRadius: 24, background: C.paper, fontFamily: FONT, color: C.ink }}>
          <div style={{ fontSize: 30, fontWeight: 700 }}>Daily Dust</div>
          <div style={{ display: 'flex', gap: 8, margin: '20px 0', alignItems: 'flex-end', height: 90 }}>
            {[0.3, 0.45, 0.4, 0.6, 0.7, 0.65, 0.85, 1].map((h, i) => (
              <div key={i} style={{ flex: 1, height: `${h * 100 * Math.min(1, done * 1.2)}%`, background: i === 7 ? C.suitGame : C.ink, borderRadius: 4 }} />
            ))}
          </div>
          <div style={{ fontSize: 22, color: C.muted }}>The same run for everyone, every day</div>
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
      <At x={260} y={340} scale={0.72}>
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
  const flip = progress(local, 34, 20, EASE_IN_OUT);
  return (
    <At x={W / 2} y={330}>
      <div style={{ fontFamily: FONT, color: C.ink, textAlign: 'center' }}>
        <div style={{ fontSize: 30, fontWeight: 600, color: C.muted, marginBottom: 20 }}>Gatherer</div>
        <div style={{ position: 'relative', height: 170, width: 640, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 150, fontWeight: 700, transform: `translateY(${-flip * 100}%)`, opacity: 1 - flip }}>+0.3/s</div>
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 150, fontWeight: 700, transform: `translateY(${(1 - flip) * 100}%)` }}>+0.25/s</div>
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
        <div style={{ width: 600, boxSizing: 'border-box', padding: 34, border: `4px solid ${C.ink}`, borderRadius: 24, background: C.paper, fontFamily: FONT, color: C.ink }}>
          <div style={{ fontSize: 22, color: C.muted, fontWeight: 600 }}>From studio@mobmachine.games</div>
          <div style={{ fontSize: 34, fontWeight: 700, marginTop: 10 }}>Shipped in Dust</div>
          <div style={{ marginTop: 22, padding: 18, border: `3px solid ${C.ink}`, borderRadius: 14, fontSize: 24, fontWeight: 600, opacity: progress(local, 60, 16), transform: `translateY(${(1 - progress(local, 60, 16)) * 16}px)` }}>
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
        <div style={{ width: 200, height: 200, borderRadius: 30, border: `4px solid ${C.ink}`, display: 'grid', placeItems: 'center', background: C.paper }}>
          <Glyph name="flag" size={90} />
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
              <div style={pill({ width: 300, justifyContent: 'center' })}>{n}</div>
            </At>
          </div>
        );
      })}
    </>
  );
}

const SCENES: Record<SceneName, (p: { local: number; len: number }) => ReactNode> = {
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

/** Every beat's scene, cross-faded on the beat's first frames, in the frame's box on the right. */
export function Scenes({ frame, g, plan }: { frame: number; g: WeeklyGeometry; plan: Layout }) {
  const b = box(g);
  const first = plan.beats[0]!.start;
  const exit = progress(frame, plan.outro - 30, 30, EASE_IN);
  return (
    <div style={{ position: 'absolute', left: b.x, top: b.y, width: b.width, height: b.height, opacity: progress(frame, first - 18, 30) * (1 - exit) }}>
      {plan.beats.map((placed, i) => {
        const shot = placed.beat.shot;
        if (!('scene' in shot)) return null;
        const Scene = SCENES[shot.scene];
        const next = plan.beats[i + 1];
        const end = next === undefined ? plan.outro : next.start;
        return (
          <Sequence key={i} from={placed.start} durationInFrames={end - placed.start + FADE} layout="none">
            <SceneLayer frame={frame} start={placed.start} end={end} last={next === undefined}>
              <Scene local={frame - placed.start} len={end - placed.start} />
            </SceneLayer>
          </Sequence>
        );
      })}
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
