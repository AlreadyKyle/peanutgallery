import type { CSSProperties, ReactNode } from 'react';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { formatDate, formatInteger, formatUsd, percent } from '../lib/format';
import { legal } from '../lib/legal';
import { canFund, DEFAULT_STUDIO_PCT, exampleFromPaid, fundLink, inFundingOrder, RESERVE_PCT } from '../lib/payment';
import type { CardDetail } from '../lib/card-source';
import type { Card, Snapshot } from '../lib/source';
import { Stat } from './Stat';
import { LinkedText } from './TextPage';

// A card's money: its funding bar and spec rows (and the "$0.00 of $3.00 · 0 contributors" line a
// /contribute choice shows), what a building or shipped card has spent, the Fund this card link, the
// coin mark, and the worked example's figures.
// Kernel (docs/specs/board-site.md): the card's own layout (Card.tsx) places these and cannot change
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
  const contributors = cardContributors(card, snapshot);
  return contributors === null ? amount : `${amount} · ${contributorsLine(contributors)}`;
}

/**
 * The funding bar: a paper track and a coin fill that ends in a 2px ink rule. The fill is placed with
 * a transform (styles.css), so the rule never scales, and it shows at least 2px once any money has
 * landed. The bar is supplementary: the spec rows and the state word carry empty and full.
 */
export function FundingBar({ card }: { card: Card }) {
  const fill = { '--fill': `${percent(card.funded_usd, card.funding_target_usd)}%` } as CSSProperties;
  return (
    <div
      className="funding-bar"
      role="progressbar"
      aria-label={card.title}
      aria-valuemin={0}
      aria-valuemax={card.funding_target_usd}
      aria-valuenow={card.funded_usd}
    >
      {card.funded_usd > 0 ? <div className="funding-bar-fill" style={fill} /> : null}
    </div>
  );
}

/** The coin mark: an ink rim, the coin fill and one inner ring. Only on Contribute and beside a dollar figure. */
export function CoinMark() {
  return (
    <svg className="coin" viewBox="0 0 16 16" width={16} height={16} aria-hidden="true" focusable="false">
      <circle className="coin-face" cx={8} cy={8} r={7.1} />
      <circle className="coin-ring" cx={8} cy={8} r={4} />
    </svg>
  );
}

/**
 * How many contributors to show on a card, or null to leave the count out: no target, or the funding
 * figures did not load. A goal card shows its count from the start; no funding row yet means 0.
 */
export function cardContributors(card: Card, snapshot: Snapshot): number | null {
  if (card.funding_target_usd <= 0 || snapshot.missing.includes('funding')) return null;
  const funding = snapshot.funding[card.id];
  if (card.shape !== 'goal' && funding === undefined) return null;
  return funding?.contributors ?? 0;
}

export type SpecRow = 'funded' | 'contributors';

/**
 * A card's spec rows: "Funded $1.50 of $3.00", then "Contributors 2" when the count is known. A row
 * in `changed` carries the change marker until the next poll (DESIGN.md, the change rule).
 */
export function SpecRows({ card, snapshot, changed = [] }: { card: Card; snapshot: Snapshot; changed?: readonly SpecRow[] }) {
  const contributors = cardContributors(card, snapshot);
  const mark = (row: SpecRow) => (changed.includes(row) ? 'changed' : undefined);
  return (
    <dl className="spec-rows">
      <div data-row="funded" className={mark('funded')}>
        <dt>{legal.fundedLabel}</dt>
        <dd>{`${formatUsd(card.funded_usd)} of ${formatUsd(card.funding_target_usd)}`}</dd>
      </div>
      {contributors === null ? null : (
        <div data-row="contributors" className={mark('contributors')}>
          <dt>{legal.contributorsLabel}</dt>
          <dd>{formatInteger(contributors)}</dd>
        </div>
      )}
    </dl>
  );
}

/**
 * How a card renders its actions. live: real links. example (/how-it-works): no link, button or
 * disclosure at all, so an illustration can never take a payment. sample (the design guide): the
 * button drawn as it looks, marked unavailable, linking nowhere.
 */
export type CardMode = 'live' | 'example' | 'sample';

/**
 * The money at the bottom of a card. Building or being checked: who is on it and what it has spent
 * so far (`who`, from the layout; only studio-billed spend is public). Funded and waiting: the full
 * bar, the spec rows and "Waiting for the agents" in the button slot. Any other card: its bar and
 * spec rows, then Fund this card while it takes money, the Payment Link with this card's id. A live
 * card takes money only while it is in the waterfall's order (public_money.funding_order), so no
 * button shows when the order did not load; a sample card draws its button while canFund says so.
 */
export function CardMoney({
  card,
  snapshot,
  titleId,
  who,
  mode = 'live',
  changed = [],
}: {
  card: Card;
  snapshot: Snapshot;
  titleId: string;
  who: string;
  mode?: CardMode;
  changed?: readonly SpecRow[];
}) {
  const env = siteEnv();
  if (card.stage === 'building' || card.stage === 'gated') {
    const spent = card.spent_usd > 0 ? `${formatUsd(card.spent_usd)} ${legal.spentSoFar}` : null;
    return <p className="card-meta">{spent === null ? who : `${who} · ${spent}`}</p>;
  }
  const money =
    card.funding_target_usd > 0 ? (
      <>
        <FundingBar card={card} />
        <SpecRows card={card} snapshot={snapshot} changed={changed} />
      </>
    ) : null;
  if (card.stage === 'funded') {
    return (
      <>
        {money}
        <p className="card-waiting">{copy.waitingForAgents}</p>
      </>
    );
  }
  let action = null;
  if (mode === 'sample' && canFund(card)) {
    action = (
      <button type="button" className="button button-secondary button-block" aria-disabled="true" aria-describedby={titleId}>
        {legal.fundThis}
      </button>
    );
  } else if (mode === 'live' && env.stripePaymentLinkUrl !== '' && inFundingOrder(snapshot, card.id)) {
    // The agreement goes with every live link to checkout, so no card layout can draw one without it
    // (docs/specs/legal-copy.md). A sample or example card links nowhere and carries none.
    action = (
      <>
        <a className="button button-secondary button-block" href={fundLink(env.stripePaymentLinkUrl, card.id)} aria-describedby={titleId}>
          {legal.fundThis}
        </a>
        <p className="muted small">
          <LinkedText text={legal.fundAgreement} />
        </p>
      </>
    );
  }
  return (
    <>
      {money}
      {action}
    </>
  );
}

/**
 * "$1.23 spent · 3 contributors · shipped 15 Sep 2026"; a card nobody funded names its source
 * instead. Only studio-billed spend is public, so a card built on the founder's time shows none.
 * When the funding figures did not load, a goal card leaves its count out instead of showing 0.
 */
export function shippedCaption(card: Card, snapshot: Snapshot, source: string): string {
  return [...shippedParts(card, snapshot, source), `${legal.shippedOn} ${formatDate(card.live_at ?? card.updated_at)}`].join(' · ');
}

/**
 * A shipped row's money line when its date sits in the row's rail: "$1.23 spent · 3 contributors",
 * or the card's source when nobody funded it. The same parts as shippedCaption, without the date.
 */
export function shippedMeta(card: Card, snapshot: Snapshot, source: string): string {
  return shippedParts(card, snapshot, source).join(' · ');
}

function shippedParts(card: Card, snapshot: Snapshot, source: string): string[] {
  const funding = snapshot.funding[card.id];
  let who: string | null = source;
  if (card.shape === 'goal' || funding !== undefined) {
    who = snapshot.missing.includes('funding') ? null : contributorsLine(funding?.contributors ?? 0);
  }
  const cost = card.spent_usd > 0 ? `${formatUsd(card.spent_usd)} ${legal.spent}` : null;
  return [cost, who].filter((part): part is string => part !== null);
}

/** The split, from the fixed constants in payment.ts: the reserve first, then the default share of each side. */
export function splitSentence(): string {
  return legal.splitLine
    .replace('{reserve}', String(RESERVE_PCT))
    .replace('{agents}', String(100 - DEFAULT_STUDIO_PCT))
    .replace('{studio}', String(DEFAULT_STUDIO_PCT));
}

// The worked example's payment, the checkout's $5 default (docs/specs/copy-pass.md).
export const EXAMPLE_PAID_USD = 5;

/**
 * /how-it-works' worked example: $5.00 paid, Stripe's fee (about, from payment.ts STRIPE_EXAMPLE_FEE),
 * the reserve, the studio's share at the default split, the emergency fund and the agent credit, each
 * from exampleFromPaid, then the waterfall's order the agent credit follows.
 */
export function PaidExample() {
  const worked = exampleFromPaid(EXAMPLE_PAID_USD);
  const rows = legal.howMoneyMoves.exampleRows;
  return (
    <>
      <dl className="stats">
        <Stat label={rows.paid} description={rows.paidNote} value={formatUsd(worked.paid)} />
        <Stat label={rows.fee} description={rows.feeNote} value={formatUsd(worked.fee)} />
        <Stat label={rows.reserve} description={rows.reserveNote.replace('{net}', formatUsd(worked.net))} value={formatUsd(worked.reserve)} />
        <Stat label={rows.studio} description={rows.studioNote.replace('{rest}', formatUsd(worked.remainder))} value={formatUsd(worked.studio)} />
        <Stat label={rows.incident} description={rows.incidentNote.replace('{agents}', formatUsd(worked.agents))} value={formatUsd(worked.incident)} />
        <Stat label={rows.credit} description={rows.creditNote} value={formatUsd(worked.credit)} />
      </dl>
      <p className="example-order-intro">{legal.howMoneyMoves.exampleOrderIntro}</p>
      <ol className="example-order">
        {legal.howMoneyMoves.exampleOrder.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </>
  );
}

/**
 * The money facts on a card's own page (docs/specs/supporter-pages.md): Funded $x of $y (the money
 * from payments that count that reached it, else what is on its bar), Contributors n (the same count
 * as the supporters list) and what studio-billed work on it cost. The page adds its other facts
 * (time to live, the commit, the gate) as `children`, in the same list. `onFace` leaves out Funded and
 * Contributors when the card's face above already shows them as its spec rows (an open or funded
 * card), so no figure is said twice.
 */
export function CardFacts({ detail, onFace = false, children }: { detail: CardDetail; onFace?: boolean; children?: ReactNode }) {
  const card = detail.card;
  const funded = detail.funding === null ? card.funded_usd : Math.max(detail.funding.credited_usd, 0);
  return (
    <dl className="facts">
      {card.funding_target_usd > 0 && !onFace ? (
        <div data-fact="funded">
          <dt>{legal.fundedLabel}</dt>
          <dd>{`${formatUsd(funded)} of ${formatUsd(card.funding_target_usd)}`}</dd>
        </div>
      ) : null}
      {onFace ? null : (
        <div data-fact="contributors">
          <dt>{legal.contributorsLabel}</dt>
          <dd>{formatInteger(detail.funding?.contributors ?? 0)}</dd>
        </div>
      )}
      <div data-fact="cost">
        <dt>{legal.costLabel}</dt>
        <dd>{formatUsd(detail.spent_usd)}</dd>
      </div>
      {children}
    </dl>
  );
}
