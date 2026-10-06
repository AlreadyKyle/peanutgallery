import { FundingBar, fundingCaption } from '../components/Funding';
import { Guarded } from '../components/Guarded';
import { PageHeader } from '../components/PageHeader';
import { StaleNotice } from '../components/StaleNotice';
import { LinkedText } from '../components/TextPage';
import { siteEnv } from '../lib/env';
import { legal } from '../lib/legal';
import { fundableCards, fundLink, nextInLine, noCardTakesMoney } from '../lib/payment';
import type { Snapshot } from '../lib/source';
import { useStudio, type StudioState } from '../lib/studio';

// Kernel (docs/specs/board-site.md): the page that sends money to the Payment Link. Its strings come
// from legal.ts, the agreement line directly under the first choice among them (docs/specs/legal-copy.md).
// Which cards it offers, in what order, and their links come from payment.ts, which reads the
// waterfall's order (public_money.funding_order, docs/specs/money-surfaces.md); every module it reads
// is kernel but PageHeader.

/** Whether public_money loaded: without it no card is named or offered. */
function hasOrder(snapshot: Snapshot): boolean {
  return !snapshot.missing.includes('money') && snapshot.money !== undefined && snapshot.money !== null;
}

/**
 * Fund the next card in line's second line: the first card in the funding order, or that the money
 * waits in Not on a card yet when no card takes money. It names no card while the order is loading
 * or did not load, or while the first card in it has not reached the page yet; the money is placed
 * by the waterfall either way.
 */
function pickForMeBody(studio: StudioState): string {
  if (studio.state !== 'ready' || !hasOrder(studio.snapshot)) return legal.pickForMeBody;
  if (noCardTakesMoney(studio.snapshot)) return legal.nextInLineNone;
  const next = nextInLine(studio.snapshot);
  return next === null ? legal.pickForMeBody : legal.nextInLine.replace('{title}', next.title);
}

/**
 * The step before checkout, on two bands (DESIGN.md, Bands): the heading and the paused notice on
 * the signal plate, the choices on paper. Fund the next card in line (money given with no card
 * funds the next cards in line), or one card from the funding order. Both go to the same Payment
 * Link; a card adds client_reference_id, which the webhook credits to that card.
 */
export function Contribute() {
  const env = siteEnv();
  const studio = useStudio();
  return (
    <main>
      <div className="band">
        <PageHeader title={legal.contributeTitle} lede={legal.contributeLede}>
          <StaleNotice studio={studio} />
        </PageHeader>
      </div>
      <div className="band">
        {env.stripePaymentLinkUrl === '' ? (
          <p>{legal.contributeUnavailable}</p>
        ) : (
          <div className="contribute">
            <a className="choice choice-primary" href={env.stripePaymentLinkUrl}>
              <span className="choice-title">{legal.pickForMe}</span>
              <span className="choice-body">{pickForMeBody(studio)}</span>
            </a>
            <p className="muted small">
              <LinkedText text={legal.contributeAgreement} />
            </p>

            <h2>{legal.orPickACard}</h2>
            <Guarded studio={studio}>
              {(snapshot) => {
                if (!hasOrder(snapshot)) return <p className="muted">{legal.partUnavailable}</p>;
                const fundable = fundableCards(snapshot);
                if (fundable.length === 0) return <p className="muted">{legal.noFundableCards}</p>;
                return (
                  <>
                    <ul className="choices">
                      {fundable.map((card) => (
                        <li key={card.id}>
                          <a className="choice" href={fundLink(env.stripePaymentLinkUrl, card.id)}>
                            <span className="choice-title">{card.title}</span>
                            {card.summary === null || card.summary.trim() === '' ? null : (
                              <span className="choice-body">{card.summary}</span>
                            )}
                            <FundingBar card={card} />
                            <span className="choice-meta">{fundingCaption(card, snapshot)}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                    <p className="muted small">{legal.waterfallLine}</p>
                  </>
                );
              }}
            </Guarded>
            <p className="muted small">{legal.split}</p>
            <p className="muted small">{legal.usdNote}</p>
          </div>
        )}
      </div>
    </main>
  );
}
