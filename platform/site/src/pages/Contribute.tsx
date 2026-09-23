import { FundingBar, fundingCaption } from '../components/Funding';
import { Guarded } from '../components/Guarded';
import { PageHeader } from '../components/PageHeader';
import { PausedNotice } from '../components/PausedNotice';
import { StaleNotice } from '../components/StaleNotice';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { legal } from '../lib/legal';
import { CATEGORY_FILTERS, categoryOf, fundableCards, fundLink, type CardCategory } from '../lib/payment';
import { useStudio } from '../lib/studio';

// Kernel (docs/specs/board-site.md): the page that sends money to the Payment Link. Its strings come
// from legal.ts; which cards it offers, in what order and under which heading, and their links, come
// from payment.ts; every module it reads is kernel but copy.ts (the category names) and PageHeader.

const CATEGORIES = CATEGORY_FILTERS.filter((filter): filter is CardCategory => filter !== 'all');

/**
 * The step before checkout, on two bands (DESIGN.md, Bands): the heading and the paused notice on
 * the signal plate, the choices on paper. Fund the next card in line (no card named: money given
 * with no card funds later cards), or one card. Both go to the same Payment Link; a card adds
 * client_reference_id, which the webhook credits to that card.
 */
export function Contribute() {
  const env = siteEnv();
  const studio = useStudio();
  return (
    <main>
      <div className="band">
        <PageHeader title={legal.contributeTitle} lede={legal.contributeLede}>
          <StaleNotice studio={studio} />
          <PausedNotice studio={studio} />
        </PageHeader>
      </div>
      <div className="band">
        {env.stripePaymentLinkUrl === '' ? (
          <p>{legal.contributeUnavailable}</p>
        ) : (
          <div className="contribute">
            <a className="choice choice-primary" href={env.stripePaymentLinkUrl}>
              <span className="choice-title">{legal.pickForMe}</span>
              <span className="choice-body">{legal.pickForMeBody}</span>
            </a>

            <h2 className="choices-heading">{legal.orPickACard}</h2>
            <Guarded studio={studio}>
              {(snapshot) => {
                const fundable = fundableCards(snapshot.cards);
                if (fundable.length === 0) return <p className="muted">{legal.noFundableCards}</p>;
                return CATEGORIES.map((category) => {
                  const cards = fundable.filter((card) => categoryOf(card) === category);
                  if (cards.length === 0) return null;
                  return (
                    <section key={category} className="choice-group" aria-labelledby={`choose-${category}`}>
                      <h3 id={`choose-${category}`}>{copy.categories[category]}</h3>
                      <ul className="choices">
                        {cards.map((card) => (
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
                    </section>
                  );
                });
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
