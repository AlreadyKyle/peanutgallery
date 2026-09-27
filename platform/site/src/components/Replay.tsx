import { useRef, useState } from 'react';
import type { CardDetail } from '../lib/card-source';
import type { Face } from '../lib/cards';
import { copy } from '../lib/copy';
import { deal, flip, fundTick, motionAllowed, slam } from '../lib/motion';
import type { Snapshot } from '../lib/source';
import { CardFace } from './Card';
import { Announcer } from './Announcer';
import { Glyph } from './Glyph';
import { stopReason } from './Stopped';

/** The pause between two replay steps; five steps and their motion finish well within 30 seconds. */
export const STEP_MS = 1_200;

type Step = { key: 'opened' | 'funded' | 'started' | 'gate' | 'shipped'; face: Face; stage: string; full: boolean; say: string };

/**
 * The card's recorded milestones as replay steps, in order, at most five: opened (the deal), funded
 * (the bar fills to its total; only for a card with a target that an agent started), started (the
 * flip to the work face), the latest gate result (the checks face) and shipped (the Live stamp and
 * the slam). A card with nothing recorded after it opened has no replay: an empty list.
 */
export function replaySteps(detail: CardDetail): Step[] {
  const m = detail.milestones;
  if (m.started_at === null && m.gate_at === null && m.live_at === null) return [];
  const steps: Step[] = [{ key: 'opened', face: 'open', stage: 'proposed', full: false, say: copy.replay.opened }];
  if (detail.card.funding_target_usd > 0 && m.started_at !== null) {
    steps.push({ key: 'funded', face: 'funded', stage: 'funded', full: true, say: copy.replay.funded });
  }
  if (m.started_at !== null) steps.push({ key: 'started', face: 'building', stage: 'building', full: true, say: copy.replay.started });
  if (m.gate_at !== null && m.gate !== null) {
    steps.push({ key: 'gate', face: 'checks', stage: 'gated', full: true, say: m.gate === 'passed' ? copy.replay.gatePassed : copy.replay.gateFailed });
  }
  if (m.live_at !== null) steps.push({ key: 'shipped', face: 'live', stage: 'live', full: true, say: copy.replay.shipped });
  return steps.slice(0, 5);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

/**
 * The card's face on its own page, with Play. Play steps through the recorded milestones with the
 * site's own motion (lib/motion.ts) at a fixed pace, says each step once in a polite live region,
 * then shows the card as it is now and reads Replay. Under reduced motion, or with nothing recorded,
 * there is no Play button and the page shows the end state.
 *
 * Same slot and height (DESIGN.md, Motion): while Play is offered, a hidden copy of every face the
 * replay can show sits in the face's grid cell, so the slot is always as tall as the tallest of them
 * and the face stretches to it. Nothing below the card, the Play button included, moves as the faces
 * change.
 */
export function Replay({ detail, snapshot }: { detail: CardDetail; snapshot: Snapshot }) {
  const steps = replaySteps(detail);
  const [at, setAt] = useState<number | null>(null);
  const [played, setPlayed] = useState(false);
  const [message, setMessage] = useState('');
  const slot = useRef<HTMLUListElement>(null);
  const playing = at !== null;
  const canPlay = steps.length > 0 && motionAllowed();
  const card = detail.card;
  const face = () => slot.current?.querySelector<HTMLElement>('li.card') ?? null;

  async function play() {
    for (const [index, step] of steps.entries()) {
      setMessage(step.say);
      if (step.key === 'opened') {
        setAt(index);
        await nextFrame();
        deal([face()].filter((el): el is HTMLElement => el !== null));
      } else if (step.key === 'funded') {
        setAt(index);
        await nextFrame();
        fundTick(slot.current?.querySelector<HTMLElement>('.funding-bar-fill') ?? null, 0, 100);
      } else if (step.key === 'shipped') {
        setAt(index);
        await nextFrame();
        slam(face());
      } else {
        await flip(face(), () => setAt(index));
      }
      await wait(STEP_MS);
    }
    setAt(null);
    setPlayed(true);
  }

  const endFace = detail.stopped === null ? undefined : detail.stopped.stage === 'paused' ? 'paused' : 'rejected';
  const reason = detail.stopped === null ? undefined : stopReason(detail.stopped);
  const asAt = (s: Step) => ({ ...card, stage: s.stage, funded_usd: s.full ? card.funding_target_usd : 0, live_at: s.key === 'shipped' ? card.live_at : null });
  const step = at === null ? null : steps[at]!;
  return (
    <div className="replay">
      <div className="card-slot">
        <ul className="card-solo" ref={slot}>
          <CardFace
            card={step === null ? card : asAt(step)}
            snapshot={snapshot}
            mode={step === null ? 'live' : 'example'}
            face={step?.face ?? endFace}
            stamp={step === null ? card.stage === 'live' : step.key === 'shipped'}
            reason={step === null ? reason : undefined}
            watch={false}
          />
        </ul>
        {canPlay ? (
          <>
            <ul className="card-sizer" aria-hidden="true" inert>
              <CardFace card={card} snapshot={snapshot} face={endFace} stamp={card.stage === 'live'} reason={reason} watch={false} ghost />
            </ul>
            {steps.map((s) => (
              <ul key={s.key} className="card-sizer" aria-hidden="true" inert>
                <CardFace card={asAt(s)} snapshot={snapshot} mode="example" face={s.face} stamp={s.key === 'shipped'} watch={false} ghost />
              </ul>
            ))}
          </>
        ) : null}
      </div>
      {canPlay ? (
        <p className="replay-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              if (!playing) void play();
            }}
            aria-disabled={playing ? 'true' : undefined}
            aria-label={played ? copy.replay.replayLabel : copy.replay.label}
          >
            <Glyph name="arrow-right" />
            {played ? copy.replay.replay : copy.replay.play}
          </button>
        </p>
      ) : null}
      <Announcer message={message} />
    </div>
  );
}
