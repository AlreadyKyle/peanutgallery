import React from 'react';
import { AbsoluteFill, Audio, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { Avatar, Card, Coin, FundingBar, IndexRule, Label, Mark, State, Suit } from './Bits';
import builderA from './site/builder-a.json';
import builderB from './site/builder-b.json';
import gameDesigner from './site/game-designer.json';
import gameDirector from './site/game-director.json';
import janitor from './site/janitor.json';
import platformBuilder from './site/platform-builder.json';
import platformDirector from './site/platform-director.json';
import qa from './site/qa.json';
import studioHead from './site/studio-head.json';
import { C, EASE_PUSH, FONT, pop, progress, tween, wobble } from './theme';

// A 15-second vertical clip of one studio moment (a ship, an open card, a milestone), drawn with the
// site's own objects: the agent's avatar from its one-line description, the card, the Live stamp,
// the coin beside money only. Every word comes from the props, which the marketer fills from the
// studio's public records, so the clip states only what is true.

const ROLES: Record<string, { name: string; species_note: string }> = {
  'Builder A': builderA,
  'Builder B': builderB,
  'Game Designer': gameDesigner,
  'Game Director': gameDirector,
  Janitor: janitor,
  'Platform Builder': platformBuilder,
  'Platform Director': platformDirector,
  QA: qa,
  'Studio Head': studioHead,
};

export type Row = { label: string; value: string; money?: boolean };
export type ClipProps = {
  kicker: string;
  title: string;
  summary: string;
  role: string;
  suit: 'game' | 'studio';
  rows: Row[];
  state: 'live' | 'open';
  funded?: number;
  ctaTop: string;
  ctaUrl: string;
};

export const CLIP_FPS = 30;
export const CLIP_FRAMES = 450;
const W = 1080;
const PAD = 84;

function Words({ text, start, size }: { text: string; start: number; size: number }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: size, lineHeight: 1.08, color: C.ink, letterSpacing: '-0.01em' }}>
      {text.split(' ').map((word, i) => {
        const p = progress(frame, start + i * 3, 14);
        return (
          <span key={i} style={{ display: 'inline-block', marginRight: '0.24em', opacity: p, transform: `translateY(${(1 - p) * 40}px)` }}>
            {word}
          </span>
        );
      })}
    </div>
  );
}

export function Moment(props: ClipProps) {
  const frame = useCurrentFrame();
  const role = ROLES[props.role] ?? builderA;
  const wipeIn = tween(frame, 48, 18, W, 0, EASE_PUSH);
  const wipeOut = tween(frame, 330, 18, W, 0, EASE_PUSH);
  const cardIn = pop(frame, 170, 'soft');
  const stamp = pop(frame, 250, 'bouncy');
  const volume = interpolate(frame, [0, 10, CLIP_FRAMES - 30, CLIP_FRAMES], [0, 0.9, 0.9, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: C.ink }}>
      <Audio src={staticFile('soundtrack.wav')} volume={volume} />

      {/* Intro: the mark and the kicker on ink. */}
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 40, opacity: frame < 70 ? 1 : 0 }}>
        <div style={{ transform: `scale(${pop(frame, 2, 'snappy')})` }}>
          <Mark size={150} color={C.paper} />
        </div>
        <Label size={40} color={C.paper} style={{ opacity: progress(frame, 14, 12) }}>
          MOB MACHINE
        </Label>
      </AbsoluteFill>

      {/* The moment, on paper. */}
      <AbsoluteFill style={{ background: C.paper, transform: `translateX(${wipeIn}px)`, borderLeft: `8px solid ${C.coin}`, padding: PAD, boxSizing: 'border-box', justifyContent: 'center' }}>
        {/* Centred, so the platforms' captions and buttons at the top and bottom cover nothing. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Label size={34} style={{ opacity: progress(frame, 62, 10) }}>
            {props.kicker.toUpperCase()}
          </Label>
          <IndexRule draw={progress(frame, 64, 16)} width={W - PAD * 2} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 36, marginTop: 70 }}>
          <div style={{ transform: `translateY(${wobble(frame, 3, 8, 60)}px) scale(${pop(frame, 72, 'bouncy')})`, transformOrigin: 'bottom center' }}>
            <Avatar note={role.species_note} size={260} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: progress(frame, 84, 12) }}>
            <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: 52, color: C.ink }}>{role.name}</span>
            <span style={{ fontFamily: FONT, fontSize: 36, color: C.muted }}>an AI agent at the studio</span>
          </div>
        </div>

        <div style={{ marginTop: 70 }}>
          <Words text={props.title} start={96} size={props.title.length > 48 ? 78 : 96} />
        </div>

        <div style={{ marginTop: 64, opacity: cardIn, transform: `translateY(${(1 - cardIn) * 120}px)` }}>
          <Card width={W - PAD * 2} pad={44}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Suit suit={props.suit} size={32} />
              <div style={{ transform: `scale(${props.state === 'live' ? stamp : 1})`, transformOrigin: 'right center' }}>
                {props.state === 'live' ? <State glyph="stamp" word="Live" size={34} stamp /> : <State glyph="pencil" word="Open for funding" size={34} />}
              </div>
            </div>
            <div style={{ fontFamily: FONT, fontSize: 40, lineHeight: 1.3, marginTop: 30 }}>{props.summary}</div>
            {props.state === 'open' && props.funded !== undefined ? (
              <div style={{ marginTop: 30 }}>
                <FundingBar fill={tween(frame, 210, 30, 0, props.funded)} height={28} />
              </div>
            ) : null}
            <div style={{ marginTop: 30, borderTop: `2px solid ${C.line}` }}>
              {props.rows.map((row, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 0', borderBottom: `2px solid ${C.line}`, opacity: progress(frame, 200 + i * 10, 12) }}>
                  <span style={{ fontFamily: FONT, fontSize: 34, color: C.muted }}>{row.label}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 14, fontFamily: FONT, fontWeight: 700, fontSize: 38, fontVariantNumeric: 'tabular-nums' }}>
                    {row.money ? <Coin size={30} /> : null}
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </AbsoluteFill>

      {/* Outro: where to go, on ink. */}
      <AbsoluteFill style={{ background: C.ink, transform: `translateX(${wipeOut}px)`, borderLeft: `8px solid ${C.coin}`, alignItems: 'center', justifyContent: 'center', gap: 48 }}>
        <Mark size={130} color={C.paper} />
        <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 76, color: C.paper, textAlign: 'center', padding: '0 80px', lineHeight: 1.1 }}>{props.ctaTop}</div>
        <Label size={44} color={C.mutedOnInk}>
          {props.ctaUrl}
        </Label>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
