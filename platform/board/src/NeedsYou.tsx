import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { formatAmount, formatDateTime, formatDay, formatUsd } from './lib/format';
import {
  CONSOLE_BILLING_URL,
  CONTACT_EMAIL,
  BOARD_PULLS_URL,
  STRIPE_DISPUTES_URL,
  STRIPE_PAYOUT_SETTINGS_URL,
  dueItems,
  fetchNeedsYou,
  purchasedSinceRun,
  type CreditDraft,
  type NeedsItem,
  type NeedsYouData,
  type RuleBlockedWhy,
} from './lib/needs';
import { errorMessage } from './lib/supabase';

// The inbox reloads once a minute; the Controller writes its figures once a day.
export const NEEDS_POLL_MS = 60_000;
export const NOTHING_NEEDS_YOU = 'Nothing needs you.';

function settlementNote(amount: number | null, currency: string | null): string {
  if (amount === null || currency === null || currency.toLowerCase() === 'usd') return '';
  return ` (${formatAmount(amount, currency)} in Stripe's currency)`;
}

/**
 * Where a card item sends the board: a link to the card's row under Cards once that row is on the
 * page, and plain words while it is not (at the first factor Cards is not shown; at the second, while
 * the cards read is loading or has failed), so no link ever points at nothing.
 */
function ToCard({ id, listed, children }: { id: string; listed: ReadonlySet<string>; children: string }) {
  return listed.has(id) ? <a href={`#card-${id}`}>{children}</a> : <>{children}</>;
}

/** Why the resume rule leaves a ceiling pause to the board, as the headline's end. */
const RULE_BLOCKED_WORDS: Record<RuleBlockedWhy, string> = {
  card_max: 'is paused at the card maximum of {max}.',
  resumed_before: 'is paused at its ceiling a second time, after it was resumed once.',
  vetoed: 'is paused at its ceiling and vetoed, so no session would run it.',
  closed_lane: 'is paused at its ceiling, and the platform code lane is closed.',
};

function Item({
  item,
  canRecord,
  listedCards,
  onFillCredit,
}: {
  item: NeedsItem;
  canRecord: boolean;
  listedCards: ReadonlySet<string>;
  onFillCredit: (draft: CreditDraft) => void;
}) {
  if (item.kind === 'dispute') {
    return (
      <li>
        <p>
          <strong>
            Answer dispute {item.dispute} for {formatUsd(item.amount_usd)}
            {item.due_by === null ? '' : ` by ${formatDay(item.due_by)}`}.
          </strong>{' '}
          Stripe decides it on the evidence you send; the Controller puts the money back if it is won.
        </p>
        <p>
          <a href={`${STRIPE_DISPUTES_URL}/${encodeURIComponent(item.dispute)}`}>Open the dispute in Stripe</a>
        </p>
      </li>
    );
  }
  if (item.kind === 'approval_void') {
    return (
      <li>
        <p>
          <strong>
            Card {item.card.title} holds {formatUsd(item.card.money_usd)} but its approval is not current.
          </strong>{' '}
          Its text was changed outside a board control, so the public does not see it, no session runs it and it takes
          no money. {canRecord ? null : 'Verify your second factor, then '}
          <ToCard id={item.card.id} listed={listedCards}>
            {canRecord ? 'Cancel it under Cards' : 'cancel it under Cards'}
          </ToCard>
          , which moves its unspent money to the next cards in line.
        </p>
      </li>
    );
  }
  if (item.kind === 'rule_blocked') {
    return (
      <li>
        <p>
          <strong>Card {item.card.title} {RULE_BLOCKED_WORDS[item.card.why].replace('{max}', formatUsd(item.card.card_max_usd))}</strong>{' '}
          It has cost {formatUsd(item.card.actual_usd)}. The rule will not resume it:{' '}
          {canRecord ? null : 'verify your second factor, then '}
          <ToCard id={item.card.id} listed={listedCards}>
            resume it with a new estimate, or cancel it, under Cards
          </ToCard>
          .
        </p>
      </li>
    );
  }
  if (item.kind === 'incident') {
    return (
      <li>
        <p>
          <strong>Card {item.card.title} is S1.</strong> If it needs more than the Console credit left, convert
          emergency-fund credit: {formatUsd(item.incident_reserve_usd)} is in the fund. Buy that credit in the Console
          and record it below.
        </p>
      </li>
    );
  }
  return (
    <li>
      <p>
        <strong>Buy {formatUsd(item.amount_usd)} of Console credit.</strong> A payout has agent money that is not
        credit yet.
      </p>
      <ol>
        <li>
          In the Console, switch to the studio organisation and buy {formatUsd(item.amount_usd)} under{' '}
          <a href={CONSOLE_BILLING_URL}>Billing</a>. Keep auto-reload off.
        </li>
        <li>
          {canRecord ? (
            <button type="button" className="button-secondary" onClick={() => onFillCredit(item.draft)}>
              Fill in the record form
            </button>
          ) : (
            'Verify your second factor, then fill in the record form from here.'
          )}{' '}
          Record the amount on the Console receipt.
        </li>
        <li>
          In Stripe, raise the <a href={STRIPE_PAYOUT_SETTINGS_URL}>Minimum balance</a> to{' '}
          {formatUsd(item.minimum_balance_usd)}
          {settlementNote(item.settlement_amount, item.settlement_currency)}.
        </li>
      </ol>
    </li>
  );
}

function ControllerLine({ data }: { data: NeedsYouData }) {
  const run = data.controller;
  if (run === null) {
    return (
      <p className="muted">
        No Controller run yet, so there is no credit or Minimum balance figure. Check{' '}
        <a href={STRIPE_DISPUTES_URL}>Stripe's disputes</a> for any that need an answer.
      </p>
    );
  }
  return (
    <>
      <p className="muted">
        Controller, {formatDateTime(run.finished_at)}:{' '}
        {run.ok ? 'the books match Stripe' : `${run.mismatches} mismatch${run.mismatches === 1 ? '' : 'es'}, named in its alert`}.
        Credit to buy {formatUsd(run.credit_purchase_usd)}. Stripe Minimum balance {formatUsd(run.minimum_balance_usd)}
        {settlementNote(run.settlement_amount, run.settlement_currency)}.
      </p>
      {purchasedSinceRun(data) && data.last_credit_purchase !== null ? (
        <p className="muted">
          A purchase of {formatUsd(data.last_credit_purchase.amount_usd)} was recorded after that run. The next run
          updates the credit figure.
        </p>
      ) : null}
    </>
  );
}

/**
 * The board's first screen: the standing duties that are due now, usually none. It reads at aal1;
 * the one control, filling in the credit form, needs the second factor like the form itself, and a
 * card item links to its row under Cards only once that row is listed (listedCards).
 */
export function NeedsYou({
  client,
  canRecord,
  listedCards,
  onFillCredit,
}: {
  client: SupabaseClient;
  canRecord: boolean;
  listedCards: ReadonlySet<string>;
  onFillCredit: (draft: CreditDraft) => void;
}) {
  const [data, setData] = useState<NeedsYouData | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let live = true;
    const load = () => {
      fetchNeedsYou(client)
        .then((next) => {
          if (!live) return;
          setData(next);
          setLoadError('');
        })
        .catch((error: unknown) => {
          if (live) setLoadError(errorMessage(error));
        });
    };
    load();
    const timer = setInterval(load, NEEDS_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [client]);

  const items = data === null ? [] : dueItems(data);

  return (
    <section aria-label="Needs you">
      <h2>Needs you</h2>
      {data === null ? (
        <p role="status">{loadError === '' ? 'Loading what needs you.' : loadError}</p>
      ) : (
        <>
          {items.length === 0 ? (
            <p>{NOTHING_NEEDS_YOU}</p>
          ) : (
            <ul className="needs">
              {items.map((item) => (
                <Item
                  key={item.kind === 'dispute' ? item.dispute : item.kind === 'credit' ? 'credit' : `${item.kind}-${item.card.id}`}
                  item={item}
                  canRecord={canRecord}
                  listedCards={listedCards}
                  onFillCredit={onFillCredit}
                />
              ))}
            </ul>
          )}
          <ControllerLine data={data} />
          {loadError === '' ? null : <p className="error">{loadError}</p>}
        </>
      )}
      <h3>Standing duties</h3>
      <ul className="standing">
        <li>
          Refund requests arrive at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Refund each one in Stripe
          within 14 days of the contribution.
        </li>
        <li>
          Every pull request that is not from a card branch waits for your merge:{' '}
          <a href={BOARD_PULLS_URL}>open pull requests not from a card branch</a>.
        </li>
      </ul>
    </section>
  );
}
