import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState, type FormEvent } from 'react';
import { draftToFloor, supplyLine, supplyShort, type SupplyLoad } from './lib/board';
import { formatAmount, formatDateTime, formatDay, formatUsd } from './lib/format';
import {
  CONSOLE_BILLING_URL,
  CONTACT_EMAIL,
  BOARD_PULLS_URL,
  STRIPE_DISPUTES_URL,
  STRIPE_PAYOUT_SETTINGS_URL,
  dueItems,
  fetchFindings,
  fetchNeedsYou,
  purchasedSinceRun,
  type CreditDraft,
  type Finding,
  type FindingKind,
  type NeedsItem,
  type NeedsYouData,
  type RuleBlockedWhy,
} from './lib/needs';
import { errorMessage } from './lib/supabase';

// The inbox reloads once a minute; the Controller writes its figures once a day.
export const NEEDS_POLL_MS = 60_000;
export const NOTHING_NEEDS_YOU =
  'Nothing needs you right now. A payout to turn into credit, a dispute, a paused or hidden card, a short card supply or a daily-check finding shows up here when there is one.';
/** Under the heading: what this list is, like an inbox. */
export const NEEDS_YOU_LEDE = 'Your inbox: what the board has to act on now. Each item says what to do.';
/** The non-card pull requests (docs/specs/agent-upkeep.md): upkeep_merge merges the patch updates that pass the policy. */
export const NON_CARD_PULLS_LINE =
  'Dependency patch updates that pass the merge policy merge by themselves. Every other pull request that is not from a card branch waits for your merge:';

function settlementNote(amount: number | null, currency: string | null): string {
  if (amount === null || currency === null || currency.toLowerCase() === 'usd') return '';
  return ` (${formatAmount(amount, currency)} in Stripe's currency)`;
}

/**
 * Where a card item sends the board: a link to the card's row under Cards once that row is on the
 * page, and plain words while it is not (at the first factor Cards is not shown; at the second, while
 * the cards read is loading or has failed), so no link ever points at nothing.
 */
function ToCard({ id, listed, children }: { id: string; listed: Pick<ReadonlySet<string>, 'has'>; children: string }) {
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
  listedCards: Pick<ReadonlySet<string>, 'has'>;
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
            {canRecord ? 'Reject it under Cards' : 'reject it under Cards'}
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
            resume it with a new estimate, or reject it, under Cards
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

/**
 * The card supply is short of the floor (docs/specs/studio-reports.md): Draft to the floor queues one
 * board-origin draft_card run with the shortfalls and the open cards, at the second factor, like every
 * role job. It runs attended while a board member is signed in here.
 */
function SupplyItem({ client, supply, canRecord }: { client: SupabaseClient; supply: SupplyLoad; canRecord: boolean }) {
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const current = supply.supply;
  if (current === null) return null;

  async function draft(event: FormEvent) {
    event.preventDefault();
    if (busy || current === null) return;
    if (reason.trim() === '') {
      setMessage('A reason is required.');
      return;
    }
    setBusy(true);
    try {
      await draftToFloor(client, reason.trim(), current);
      setMessage('Queued. The Game Designer drafts while a board member is signed in here; each draft is checked and graded like any card.');
      setReason('');
      await supply.refresh();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li data-needs="supply">
      <p>
        <strong>Card supply is short.</strong> {supplyLine(current)}.
      </p>
      {canRecord ? (
        <form className="stack" onSubmit={draft} aria-label="Draft to the floor">
          <label>
            Reason
            <input value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <button type="submit" aria-disabled={busy}>
            Draft to the floor
          </button>
          {/* Inside the form, as on every board form, so its 16 px gap clears the button's focus ring. */}
          {message === '' ? null : <p role="status">{message}</p>}
        </form>
      ) : (
        <p>Verify your second factor, then draft to the floor from here.</p>
      )}
    </li>
  );
}

/** A finding's kind, as the board reads it. */
export const FINDING_KIND_WORDS: Record<FindingKind, string> = {
  schema: 'Schema drift',
  model: 'Model',
  cli: 'Claude Code pin',
  scan: 'Weekly scan',
  producer: 'Producer signal',
};

/** A detail value that is a GitHub address (the weekly scan's run and job) is a link; the rest is text. */
function DetailValue({ value }: { value: string }) {
  return /^https:\/\/github\.com\/[^\s]+$/.test(value) ? <a href={value}>{value}</a> : <>{value}</>;
}

/**
 * The Janitor's open findings (docs/specs/agent-upkeep.md): what its daily check found, oldest first,
 * each with its kind, subject, figures and when it opened. They are the board's to read and act on; a
 * finding changes nothing and files no card, and the check closes it once it passes.
 */
function FindingsList({ findings }: { findings: Finding[] }) {
  return (
    <>
      <h3>Findings</h3>
      <p className="muted">The Janitor's daily check lists each difference here and closes it once the check passes.</p>
      <ul className="needs findings">
        {findings.map((finding) => (
          <li key={finding.fingerprint} data-finding={finding.kind}>
            <p>
              <strong>
                {FINDING_KIND_WORDS[finding.kind]}: {finding.subject}.
              </strong>{' '}
              Opened {formatDateTime(finding.opened_at)}
              {finding.last_seen_at === finding.opened_at ? '' : `, last seen ${formatDateTime(finding.last_seen_at)}`}.
            </p>
            {finding.detail.length === 0 ? null : (
              <ul className="finding-detail">
                {finding.detail.map(([key, value]) => (
                  <li key={key}>
                    {key.replaceAll('_', ' ')}: <DetailValue value={value} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </>
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
  supply,
}: {
  client: SupabaseClient;
  canRecord: boolean;
  listedCards: Pick<ReadonlySet<string>, 'has'>;
  onFillCredit: (draft: CreditDraft) => void;
  /** The card supply (card_supply); short of the floor, it is an item here. Unset, no supply item. */
  supply?: SupplyLoad;
}) {
  const [data, setData] = useState<NeedsYouData | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loadError, setLoadError] = useState('');
  const [findingsError, setFindingsError] = useState('');

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
      // The findings load on their own, so a failed read of them never hides a duty.
      fetchFindings(client)
        .then((open) => {
          if (!live) return;
          setFindings(open);
          setFindingsError('');
        })
        .catch((error: unknown) => {
          if (live) setFindingsError(`Findings: ${errorMessage(error)}`);
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
  const short = supply !== undefined && supply.supply !== null && supplyShort(supply.supply);

  return (
    <section aria-label="Needs you">
      <h2>Needs you</h2>
      <p className="muted">{NEEDS_YOU_LEDE}</p>
      {data === null ? (
        <p role="status">{loadError === '' ? 'Loading what needs you.' : loadError}</p>
      ) : (
        <>
          {items.length === 0 && !short && findings.length === 0 ? (
            <p>{NOTHING_NEEDS_YOU}</p>
          ) : (
            <ul className="needs">
              {short && supply !== undefined ? <SupplyItem client={client} supply={supply} canRecord={canRecord} /> : null}
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
          {findings.length === 0 ? null : <FindingsList findings={findings} />}
          {findingsError === '' ? null : <p className="error">{findingsError}</p>}
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
          {NON_CARD_PULLS_LINE}{' '}
          <a href={BOARD_PULLS_URL}>open pull requests not from a card branch</a>.
        </li>
      </ul>
    </section>
  );
}
