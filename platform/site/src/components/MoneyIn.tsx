import { formatDate, formatInteger, formatUsd } from '../lib/format';
import { legal } from '../lib/legal';
import { DEFAULT_STUDIO_PCT } from '../lib/payment';
import type { Money, Snapshot } from '../lib/source';
import { unavailableLine, type StudioState } from '../lib/studio';
import { Stat } from './Stat';

// Kernel (docs/specs/money-surfaces.md): /ledger's Money in band, from public_money. What supporters
// paid, the fees, refunds and disputes taken off it, and where the rest went. The figures add up:
// received - Stripe fees - refunded - disputed + corrections = reserve + studio + emergency fund +
// held + agent credit (docs/specs/money-logic.md); held money and corrections show only when not
// zero. Under them, exactly one line says whether the books were last reconciled with Stripe.

/** "from 3 contributions" under the received figure. */
export function paymentsLine(payments: number): string {
  return payments === 1 ? legal.moneyFromOne : legal.moneyFromMany.replace('{n}', formatInteger(payments));
}

/** The studio figure's description, with the average split supporters chose when there is one. */
export function studioDescription(pct: number | null): string {
  if (pct === null) return legal.describeStudio;
  const average = legal.studioPctAvg.replace('{pct}', String(Math.round(pct))).replace('{default}', String(DEFAULT_STUDIO_PCT));
  return `${legal.describeStudio} ${average}`;
}

/** The one reconciliation line: when the latest reconcile passed, or not yet (none ran, or the last failed). */
export function reconcileLine(money: Money): string {
  if (money.last_run_ok === true && money.reconciled_at !== null) {
    return legal.reconciledOn.replace('{date}', formatDate(money.reconciled_at));
  }
  return legal.notReconciled;
}

/** The books when public_money loaded, else null. */
function loadedMoney(snapshot: Snapshot): Money | null {
  if (snapshot.missing.includes('money') || snapshot.money === undefined) return null;
  return snapshot.money;
}

/**
 * The Funding band's Not on a card yet figure, from not_on_card_usd. When public_money did not load,
 * Stat's unread row says "Not available right now." under the label, never in the figure's place.
 */
export function NotOnCardStat({ snapshot }: { snapshot: Snapshot }) {
  const money = loadedMoney(snapshot);
  return <Stat label={legal.notOnCard} description={legal.describeNotOnCard} value={money === null ? null : formatUsd(money.not_on_card_usd)} />;
}

/**
 * Under the Funding band's figures: the one case where Not on a card yet funds a card that is not the
 * next to open (a rule, so it is said whether or not the figures loaded; a full-width line, since
 * beside the figure it would stand a tall column against a one-line amount), then how the pool is made
 * up, the shortfall while there is one and the studio's test payment while it is booked.
 */
export function FundingLines({ snapshot }: { snapshot: Snapshot }) {
  const money = loadedMoney(snapshot);
  return (
    <>
      <p className="muted small">{legal.notOnCardTopUp}</p>
      {money === null ? null : <FundingFigureLines money={money} snapshot={snapshot} />}
    </>
  );
}

/**
 * Unspent on card bars: the pool less the test payment's credit less Not on a card yet, which may be
 * below zero (money.not_on_card_usd() is that difference by its definition; docs/specs/ledger-figures.md).
 */
export function unspentOnBars(balance: number, money: Money): number {
  return balance - money.board_test_usd - (money.not_on_card_usd - money.short_usd);
}

/**
 * How the pool is made up, two ways (docs/specs/ledger-figures.md): agent credit and the test payment's
 * credit less agent spend; then unspent on card bars, the test payment's and Not on a card yet (or the
 * shortfall). Null when the pool or the totals did not load, since then the figures cannot be shown.
 */
export function poolLines(snapshot: Snapshot, money: Money): [string, string] | null {
  if (snapshot.pool === null || snapshot.missing.includes('totals')) return null;
  const test = money.board_test_usd;
  const from = legal.poolFromLine
    .replace('{credit}', formatUsd(money.agent_credit_usd))
    .replace('{test}', test > 0 ? legal.poolFromTest.replace('{test}', formatUsd(test)) : '')
    .replace('{spend}', formatUsd(snapshot.totals.usd_total));
  const rest =
    money.short_usd > 0
      ? legal.poolSplitShort.replace('{short}', formatUsd(money.short_usd))
      : legal.poolSplitFree.replace('{free}', formatUsd(money.not_on_card_usd));
  const split = legal.poolSplitLine
    .replace('{bars}', formatUsd(Math.max(0, unspentOnBars(snapshot.pool.balance_usd, money))))
    .replace('{test}', test > 0 ? legal.poolSplitTest.replace('{test}', formatUsd(test)) : '')
    .replace('{rest}', rest);
  return [from, split];
}

/** The test payment's line: its three shares when the document carries them, else its pool figure alone. */
export function testPaymentLine(money: Money): string | null {
  if (money.board_test_usd <= 0) return null;
  if (money.test === undefined || money.test === null) return legal.boardTestLine.replace('{usd}', formatUsd(money.board_test_usd));
  return legal.testSharesLine
    .replace('{paid}', formatUsd(money.test.paid_usd))
    .replace('{pool}', formatUsd(money.board_test_usd))
    .replace('{reserve}', formatUsd(money.test.reserve_usd))
    .replace('{incident}', formatUsd(money.test.incident_usd));
}

function FundingFigureLines({ money, snapshot }: { money: Money; snapshot: Snapshot }) {
  const pool = poolLines(snapshot, money);
  const test = testPaymentLine(money);
  return (
    <>
      {pool === null ? null : (
        <p className="muted small" data-pool="made-up">
          {pool.join(' ')}
        </p>
      )}
      {money.short_usd > 0 ? <p className="muted small">{legal.shortBy.replace('{usd}', formatUsd(money.short_usd))}</p> : null}
      {test === null ? null : <p className="muted small">{test}</p>}
    </>
  );
}

export function MoneyInFigures({ money }: { money: Money }) {
  return (
    <>
      {money.payments === 0 ? (
        <p>{legal.moneyInEmpty}</p>
      ) : (
        <dl className="stats">
          <Stat label={legal.received} description={legal.describeReceived} note={paymentsLine(money.payments)} value={formatUsd(money.received_usd)} />
          <Stat label={legal.stripeFees} description={legal.describeStripeFees} value={formatUsd(money.stripe_fees_usd)} />
          <Stat label={legal.refunded} description={legal.describeRefunded} value={formatUsd(money.refunded_usd)} />
          <Stat label={legal.disputed} description={legal.describeDisputed} value={formatUsd(money.disputed_usd)} />
          {money.corrections_usd === 0 ? null : (
            <Stat label={legal.corrections} description={legal.describeCorrections} value={formatUsd(money.corrections_usd)} />
          )}
          <Stat label={legal.toReserve} description={legal.describeToReserve} value={formatUsd(money.reserve_usd)} />
          <Stat label={legal.toStudio} description={studioDescription(money.studio_pct_avg)} value={formatUsd(money.studio_usd)} />
          <Stat label={legal.toIncident} description={legal.describeToIncident} value={formatUsd(money.incident_usd)} />
          {money.held_usd === 0 ? null : (
            <Stat label={legal.heldMoneyIn} description={legal.describeHeldMoneyIn} value={formatUsd(money.held_usd)} />
          )}
          <Stat label={legal.agentCredit} description={legal.describeAgentCredit} value={formatUsd(money.agent_credit_usd)} />
        </dl>
      )}
      <p className="muted small" data-reconcile="">
        {reconcileLine(money)}
      </p>
    </>
  );
}

/** The band's body: the figures, or the line that says why there are none. */
export function MoneyIn({ studio }: { studio: StudioState }) {
  if (studio.state === 'loading') return <p className="muted">{legal.loadingFigures}</p>;
  if (studio.state !== 'ready') return <p className="muted">{unavailableLine(studio)}</p>;
  const money = loadedMoney(studio.snapshot);
  if (money === null) return <p className="muted">{legal.partUnavailable}</p>;
  return <MoneyInFigures money={money} />;
}
