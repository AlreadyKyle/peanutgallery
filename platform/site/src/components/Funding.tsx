import { siteEnv } from '../lib/env';
import { formatDate, formatInteger, formatUsd, percent } from '../lib/format';
import { legal } from '../lib/legal';
import { canFund, exampleSplit, fundLink } from '../lib/payment';
import type { Card, Snapshot } from '../lib/source';
import { Stat } from './Stat';

// A card's money: its funding bar and the "$0.00 of $3.00 · 0 contributors" line under it, what a
// building or shipped card has spent, the Fund this card link, and the split example's figures.
// Kernel (docs/specs/board-site.md): the card's own layout (Cards.tsx) places these and cannot change
// a figure, the link or the card id it carries.

export function contributorsLine(count: number): string {
  return count === 1 ? legal.contributorsOne : legal.contributorsMany.replace('{n}', formatInteger(count));
}

/**
 * "$0.00 of $3.00 · 0 contributors" for a card with a target, or null. The count is left out when
 * the funding figures did not load, instead of showing 0.
 */
export function fundingCaption(card: Card, snapshot: Snapshot): string | null {
  if (card.funding_target_usd <= 0) return null;
  const amount = `${formatUsd(card.funded_usd)} of ${formatUsd(card.funding_target_usd)}`;
  if (snapshot.missing.includes('funding')) return amount;
  const funding = snapshot.funding[card.id];
  // A goal card shows its count from the start; no funding row yet means 0.
  const showContributors = card.shape === 'goal' || funding !== undefined;
  return showContributors ? `${amount} · ${contributorsLine(funding?.contributors ?? 0)}` : amount;
}

export function FundingBar({ card }: { card: Card }) {
  return (
    <div
      className="bar"
      role="progressbar"
      aria-label={card.title}
      aria-valuemin={0}
      aria-valuemax={card.funding_target_usd}
      aria-valuenow={card.funded_usd}
    >
      <div className="bar-fill" style={{ width: `${percent(card.funded_usd, card.funding_target_usd)}%` }} />
    </div>
  );
}

/**
 * The money at the bottom of a card box. A card that is building or being checked shows what it has
 * spent so far and who filed it (`source`, from the layout); any other card shows its bar and caption,
 * then Fund this card while it can take money, the Payment Link with this card's id. In example mode
 * (/how-it-works) there is no link, whatever canFund or the Payment Link say.
 */
export function CardMoney({
  card,
  snapshot,
  titleId,
  source,
  example = false,
}: {
  card: Card;
  snapshot: Snapshot;
  titleId: string;
  source: string;
  example?: boolean;
}) {
  const env = siteEnv();
  const building = card.stage === 'building' || card.stage === 'gated';
  if (building) {
    return (
      <p className="card-meta">
        {card.spent_usd > 0 ? `${formatUsd(card.spent_usd)} ${legal.spentSoFar} · ` : ''}
        {source}
      </p>
    );
  }
  const caption = fundingCaption(card, snapshot);
  return (
    <>
      {caption === null ? null : (
        <>
          <FundingBar card={card} />
          <p className="card-meta">{caption}</p>
        </>
      )}
      {!example && env.stripePaymentLinkUrl !== '' && canFund(card) ? (
        <a className="button button-secondary button-block" href={fundLink(env.stripePaymentLinkUrl, card.id)} aria-describedby={titleId}>
          {legal.fundThis}
        </a>
      ) : null}
    </>
  );
}

/**
 * "$1.23 spent · 3 contributors · shipped 15 Sep 2026"; a card nobody funded names its source
 * instead. Only studio-billed spend is public, so a card built on the founder's time shows none.
 * When the funding figures did not load, a goal card leaves its count out instead of showing 0.
 */
export function shippedCaption(card: Card, snapshot: Snapshot, source: string): string {
  const funding = snapshot.funding[card.id];
  let who: string | null = source;
  if (card.shape === 'goal' || funding !== undefined) {
    who = snapshot.missing.includes('funding') ? null : contributorsLine(funding?.contributors ?? 0);
  }
  const cost = card.spent_usd > 0 ? `${formatUsd(card.spent_usd)} ${legal.spent} · ` : '';
  const count = who === null ? '' : `${who} · `;
  return `${cost}${count}${legal.shippedOn} ${formatDate(card.live_at ?? card.updated_at)}`;
}

// The split example's contribution after Stripe's fee: its rows' notes in legal.ts are worked for it.
const SPLIT_EXAMPLE_NET_USD = 10;

/** The default split of a $10.00 contribution after Stripe's fee, as figures, for /how-it-works. */
export function SplitStats() {
  const split = exampleSplit(SPLIT_EXAMPLE_NET_USD);
  const rows = legal.howMoneyMoves.splitRows;
  return (
    <dl className="stats">
      <Stat label={rows.reserve} description={rows.reserveNote} value={formatUsd(split.reserve)} />
      <Stat label={rows.studio} description={rows.studioNote} value={formatUsd(split.studio)} />
      <Stat label={rows.incident} description={rows.incidentNote} value={formatUsd(split.incident)} />
      <Stat label={rows.credit} description={rows.creditNote} value={formatUsd(split.credit)} />
    </dl>
  );
}
