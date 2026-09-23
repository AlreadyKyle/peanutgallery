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
 * The Funding band's Not on a card yet figure, from not_on_card_usd; "Not available right now." in
 * its place when public_money did not load.
 */
export function NotOnCardStat({ snapshot }: { snapshot: Snapshot }) {
  const money = loadedMoney(snapshot);
  return (
    <Stat label={legal.notOnCard} description={legal.describeNotOnCard} value={money === null ? legal.partUnavailable : formatUsd(money.not_on_card_usd)} />
  );
}

/** Under the Funding band's figures: the shortfall while there is one, and the board's test payment while it is booked. */
export function FundingLines({ snapshot }: { snapshot: Snapshot }) {
  const money = loadedMoney(snapshot);
  if (money === null) return null;
  return (
    <>
      {money.short_usd > 0 ? <p className="muted small">{legal.shortBy.replace('{usd}', formatUsd(money.short_usd))}</p> : null}
      {money.board_test_usd > 0 ? <p className="muted small">{legal.boardTestLine.replace('{usd}', formatUsd(money.board_test_usd))}</p> : null}
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
