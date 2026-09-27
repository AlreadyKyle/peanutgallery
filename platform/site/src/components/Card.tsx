import { Link } from 'react-router-dom';
import { categoryOf, faceOf, sourceLabel, type Face } from '../lib/cards';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { legal } from '../lib/legal';
import type { Card, Snapshot } from '../lib/source';
import { CardMoney, shippedCaption, type CardMode, type SpecRow } from './Funding';
import { Glyph, StateTag, SuitTag } from './Glyph';

// The card, the one object on the page (DESIGN.md, The card). A white face with a 2px ink edge; a
// corner index with the suit and the state, the title and summary, then the money and the action
// pinned to the bottom. Its money comes from Funding.tsx (kernel), which this layout cannot change.

function blank(text: string | null): boolean {
  return text === null || text.trim() === '';
}

/**
 * The line beside agent-written card text (docs/specs/agent-workflows.md): the drafting role's title
 * from the roles already loaded, or the plain line when they did not load; null on a card no agent
 * wrote.
 */
export function writtenBy(card: Card, snapshot: Snapshot): string | null {
  if (!card.drafter_role_id) return null;
  const role = snapshot.roles.find((r) => r.id === card.drafter_role_id);
  return role === undefined ? copy.writtenByAgent : copy.writtenBy.replace('{role}', role.title);
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
  /**
   * A building or checks face links the card's own page, "Watch how it's built", in live mode
   * (docs/specs/supporter-pages.md). The card's own page draws its face with this off.
   */
  watch?: boolean;
  /**
   * A hidden copy that only holds a slot's height (Replay.tsx): its title carries no id, so the id the
   * visible face's links point at stays unique.
   */
  ghost?: boolean;
};

/**
 * One card, in the face its stage gives. In example mode (/how-it-works) it renders no link, button
 * or disclosure at all, whatever the Payment Link says, so an illustration can never take a payment.
 */
export function CardFace({ card, snapshot, mode = 'live', face, stamp = false, reason, changed = [], focusable = false, watch = true, ghost = false }: CardFaceProps) {
  const env = siteEnv();
  const shown = face ?? faceOf(card);
  const titleId = `${mode}-title-${card.id}`;
  const playable = shown === 'live' && card.folder === 'seed-1' && env.playUrl !== '';
  const byline = writtenBy(card, snapshot);
  const summary = blank(card.summary) ? null : <p className="card-summary">{card.summary}</p>;
  return (
    <li className="card" data-face={shown} data-card={card.id}>
      <p className="card-index">
        <SuitTag suit={categoryOf(card)} />
        <StateTag face={shown} stamp={stamp && shown === 'live'} />
      </p>
      <h3 id={ghost ? undefined : titleId} tabIndex={focusable ? -1 : undefined}>
        {card.title}
      </h3>
      {/* The byline shares the summary's block, so a card keeps its four parts and a card no agent
          wrote is laid out exactly as before (styles.css, the card subgrid). */}
      {byline === null ? (
        summary
      ) : (
        <div className="card-text">
          {summary}
          <p className="card-meta card-byline">{byline}</p>
        </div>
      )}
      <div className="card-bottom">
        {shown === 'rejected' ? (
          <>
            {reason === undefined ? null : <p className="card-meta">{reason}</p>}
            {/* A real card's own page says where its money went, card by card, below the face. */}
            {mode === 'sample' ? <p className="card-meta">{legal.notBuiltMoney}</p> : null}
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
        {watch && mode === 'live' && (shown === 'building' || shown === 'checks') ? (
          <p className="card-watch">
            <Link to={`/card/${card.id}`} aria-describedby={titleId}>
              {copy.cardPage.watchBuilt}
            </Link>
          </p>
        ) : null}
      </div>
    </li>
  );
}
