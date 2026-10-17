import { useId, useState } from 'react';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { legal } from '../lib/legal';
import { fundLink } from '../lib/payment';
import { CoinMark, FundAgreement } from './Funding';
import { Glyph, SuitTag } from './Glyph';

// The Machine card (docs/specs/final-state.md, Card suits): general support for the whole studio,
// always open, with no bar that fills and closes. It goes to the same checkout as "Fund the next card
// in line" (lib/payment.ts fundLink with no card), so the waterfall places the money exactly as it
// does there; nothing here changes where money goes. The preset amounts are a suggestion the reader
// carries to checkout, which asks for the amount.

export const MACHINE_AMOUNTS: readonly number[] = [5, 10, 25, 50, 100];

export function MachineCard({ studioPct, headingLevel = 3 }: { studioPct?: number; headingLevel?: 2 | 3 }) {
  const env = siteEnv();
  const id = useId();
  const [amount, setAmount] = useState(10);
  if (env.stripePaymentLinkUrl === '') return null;
  const Title = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className="machine-card" data-suit="machine" aria-labelledby={`${id}-title`}>
      <div className="machine-about">
        <p className="card-index">
          <SuitTag suit="machine" />
          <span className="tag">
            <Glyph name="coin-outline" />
            {copy.machine.always}
          </span>
        </p>
        <Title id={`${id}-title`}>{copy.machine.title}</Title>
        <p className="machine-body">{copy.machine.body}</p>
      </div>
      <div className="machine-fund">
        <div className="machine-amounts" role="group" aria-label={copy.machine.amountsLabel}>
          {MACHINE_AMOUNTS.map((usd) => (
            <button key={usd} type="button" className="filter amount" aria-pressed={amount === usd} onClick={() => setAmount(usd)}>
              {amount === usd ? <Glyph name="check" /> : null}${usd}
            </button>
          ))}
      </div>
      <p className="machine-action">
        <a className="button btn-coin" href={fundLink(env.stripePaymentLinkUrl, null, studioPct)} aria-describedby={`${id}-note`}>
          <CoinMark />
          {copy.machine.fund.replace('{amount}', `$${amount}`)}
        </a>
      </p>
      <p className="muted small" id={`${id}-note`}>
        {legal.pickForMeBody} {copy.machine.amountNote.replace('{amount}', `$${amount}`)}
      </p>
      {/* The agreement sits with the link it binds, as under every fund grid (DESIGN.md, the card). */}
      <FundAgreement />
      </div>
    </div>
  );
}
