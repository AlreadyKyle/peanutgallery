import { formatInteger, formatUsd, percent } from '../lib/format';
import { legal } from '../lib/legal';
import type { Card, Snapshot } from '../lib/source';

// A card's money: its funding bar and the "$0.00 of $3.00 · 0 contributors" line under it, on the
// card and on /contribute. Kernel (docs/specs/board-site.md): the card's own layout is not.

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
