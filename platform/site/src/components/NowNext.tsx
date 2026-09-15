import type { ReactNode } from 'react';
import { canFund, fundLink, sourceLabel, splitCards, statusOf } from '../lib/cards';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { formatInteger, formatUsd, percent } from '../lib/format';
import type { Card, Snapshot } from '../lib/source';
import type { StudioState } from '../lib/studio';

function Guarded({
  studio,
  children,
}: {
  studio: StudioState;
  children: (snapshot: Snapshot) => ReactNode;
}) {
  if (studio.state === 'loading') {
    return <p className="muted">{copy.loadingCards}</p>;
  }
  if (studio.state !== 'ready') {
    return <p className="muted">{copy.meterUnavailable}</p>;
  }
  return <>{children(studio.snapshot)}</>;
}

export function NowList({ studio }: { studio: StudioState }) {
  return (
    <Guarded studio={studio}>
      {(snapshot) => {
        const { now } = splitCards(snapshot.cards);
        if (now.length === 0) return <p className="muted">{copy.nowEmpty}</p>;
        return (
          <ul className="cards">
            {now.map((card) => (
              <NowCard key={card.id} card={card} />
            ))}
          </ul>
        );
      }}
    </Guarded>
  );
}

export function NextList({ studio }: { studio: StudioState }) {
  return (
    <Guarded studio={studio}>
      {(snapshot) => {
        const { next } = splitCards(snapshot.cards);
        if (next.length === 0) return <p className="muted">{copy.nextEmpty}</p>;
        return (
          <ul className="cards">
            {next.map((card) => (
              <NextCard key={card.id} card={card} snapshot={snapshot} />
            ))}
          </ul>
        );
      }}
    </Guarded>
  );
}

function NowCard({ card }: { card: Card }) {
  const status = statusOf(card) === 'gated' ? copy.statusGated : copy.statusBuilding;
  return (
    <li className="card">
      <h3>{card.title}</h3>
      <p className="card-meta">
        {status} · {sourceLabel(card.source)}
      </p>
      <Summary text={card.summary} />
      <p className="card-meta">
        {formatUsd(card.actual_usd)} {copy.spentSoFar}
      </p>
      <Brief intent={card.intent} />
    </li>
  );
}

function blank(text: string | null): boolean {
  return text === null || text.trim() === '';
}

// The public line for supporters, shown under the title.
function Summary({ text }: { text: string | null }) {
  if (blank(text)) return null;
  return <p className="card-summary">{text}</p>;
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

function contributorsLine(count: number): string {
  return count === 1
    ? copy.contributorsOne
    : copy.contributorsMany.replace('{n}', formatInteger(count));
}

function NextCard({ card, snapshot }: { card: Card; snapshot: Snapshot }) {
  const env = siteEnv();
  const titleId = `card-title-${card.id}`;
  const statusWord = statusOf(card) === 'decided' ? copy.statusDecided : copy.statusOpen;
  const funding = snapshot.funding[card.id];
  const showLink = env.stripePaymentLinkUrl !== '' && canFund(card);
  // A goal card with a target shows its count from the start; no row yet means 0.
  const showContributors =
    card.funding_target_usd > 0 && (card.shape === 'goal' || funding !== undefined);
  const amount = `${formatUsd(card.funded_usd)} of ${formatUsd(card.funding_target_usd)}`;
  return (
    <li className="card">
      <h3 id={titleId}>{card.title}</h3>
      <p className="card-meta">
        {statusWord} · {sourceLabel(card.source)}
      </p>
      <Summary text={card.summary} />
      {card.funding_target_usd > 0 ? (
        <div className="card-track">
          <div
            className="bar"
            role="progressbar"
            aria-label={card.title}
            aria-valuemin={0}
            aria-valuemax={card.funding_target_usd}
            aria-valuenow={card.funded_usd}
          >
            <div
              className="bar-fill"
              style={{ width: `${percent(card.funded_usd, card.funding_target_usd)}%` }}
            />
          </div>
          <p className="card-meta">
            <span className="card-amount">{amount}</span>
            {showContributors ? ` · ${contributorsLine(funding?.contributors ?? 0)}` : null}
          </p>
        </div>
      ) : null}
      {showLink ? (
        <p>
          <a
            className="button button-secondary"
            href={fundLink(env.stripePaymentLinkUrl, card.id)}
            aria-describedby={titleId}
          >
            {copy.fundThis}
          </a>
        </p>
      ) : null}
      <Brief intent={card.intent} />
    </li>
  );
}
