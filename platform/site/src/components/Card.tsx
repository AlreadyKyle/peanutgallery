import { categoryOf, faceOf, sourceLabel, type Face } from '../lib/cards';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { legal } from '../lib/legal';
import type { Card, Snapshot } from '../lib/source';
import { CardMoney, shippedCaption, type CardMode, type SpecRow } from './Funding';
import { Glyph, STATE_TAGS, SUITS } from './Glyph';

// The card, the one object on the page (DESIGN.md, The card). A white face with a 2px ink edge; a
// corner index with the suit and the state, the title and summary, then the money and the action
// pinned to the bottom. Its money comes from Funding.tsx (kernel), which this layout cannot change.

function blank(text: string | null): boolean {
  return text === null || text.trim() === '';
}

// The agent brief stays public but collapsed behind a native disclosure.
function Brief({ intent }: { intent: string | null }) {
  if (blank(intent)) return null;
  return (
    <details className="brief">
      <summary>{copy.agentBrief}</summary>
      <p>{intent}</p>
    </details>
  );
}

/** Who is on a building card: the role building it when the roles loaded, else who filed it. */
export function whoOn(card: Card, snapshot: Snapshot): string {
  const role = card.executor_role_id === null ? undefined : snapshot.roles.find((r) => r.id === card.executor_role_id);
  if (role === undefined) return sourceLabel(card.source);
  return card.stage === 'building' ? copy.buildingBy.replace('{name}', role.name) : role.name;
}

export type CardFaceProps = {
  card: Card;
  snapshot: Snapshot;
  /** live: real links. example: no link, button or disclosure. sample: the design guide's drawn buttons. */
  mode?: CardMode;
  /** Draw a face the stage does not give: paused or rejected, on the design guide only. */
  face?: Face;
  /** The Live stamp at an angle instead of the plain tag (the guide, and a card's own page). */
  stamp?: boolean;
  /** Why a rejected card was not built: the public reason. */
  reason?: string;
  /** Spec rows that changed since the last poll: they carry the change marker. */
  changed?: readonly SpecRow[];
  /** The title takes focus from script (the fund grid's Show all moves focus to it). */
  focusable?: boolean;
};

/**
 * One card, in the face its stage gives. In example mode (/how-it-works) it renders no link, button
 * or disclosure at all, whatever the Payment Link says, so an illustration can never take a payment.
 */
export function CardFace({ card, snapshot, mode = 'live', face, stamp = false, reason, changed = [], focusable = false }: CardFaceProps) {
  const env = siteEnv();
  const shown = face ?? faceOf(card);
  const suit = SUITS[categoryOf(card)];
  const state = STATE_TAGS[shown];
  const titleId = `${mode}-title-${card.id}`;
  const playable = shown === 'live' && card.folder === 'seed-1' && env.playUrl !== '';
  return (
    <li className="card" data-face={shown} data-card={card.id}>
      <p className="card-index">
        <span className="tag" data-suit={categoryOf(card)}>
          <Glyph name={suit.glyph} />
          {suit.label}
        </span>
        <span className={stamp && shown === 'live' ? 'tag tag-stamp' : 'tag'} data-state={shown}>
          <Glyph name={state.glyph} />
          {state.word}
        </span>
      </p>
      <h3 id={titleId} tabIndex={focusable ? -1 : undefined}>
        {card.title}
      </h3>
      {blank(card.summary) ? null : <p className="card-summary">{card.summary}</p>}
      <div className="card-bottom">
        {shown === 'rejected' ? (
          <>
            {reason === undefined ? null : <p className="card-meta">{reason}</p>}
            <p className="card-meta">{legal.notBuiltMoney}</p>
          </>
        ) : shown === 'live' ? (
          <>
            <p className="card-meta">{shippedCaption(card, snapshot, sourceLabel(card.source))}</p>
            {!playable || mode === 'example' ? null : mode === 'sample' ? (
              <button type="button" className="button button-block" aria-disabled="true" aria-describedby={titleId}>
                <Glyph name="cartridge" />
                {copy.playTheGame}
              </button>
            ) : (
              <a className="button button-block" href={env.playUrl} aria-describedby={titleId}>
                <Glyph name="cartridge" />
                {copy.playTheGame}
              </a>
            )}
          </>
        ) : (
          <CardMoney card={card} snapshot={snapshot} titleId={titleId} who={whoOn(card, snapshot)} mode={mode} changed={changed} />
        )}
        {mode === 'example' ? null : <Brief intent={card.intent} />}
      </div>
    </li>
  );
}
