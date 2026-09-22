import { FundingBar, Guarded, fundingCaption } from '../components/Cards';
import { PageHeader } from '../components/PageHeader';
import { PausedNotice } from '../components/PausedNotice';
import { StaleNotice } from '../components/StaleNotice';
import { CATEGORY_FILTERS, canFund, categoryOf, fundLink, groupCards, type CardCategory } from '../lib/cards';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { useStudio } from '../lib/studio';

const CATEGORIES = CATEGORY_FILTERS.filter((filter): filter is CardCategory => filter !== 'all');

/**
 * The step before checkout: send the money wherever it is needed, or to one card. Both go to the
 * same Payment Link; a card adds client_reference_id, which the webhook credits to that card.
 */
export function Contribute() {
  const env = siteEnv();
  const studio = useStudio();
  return (
    <main>
      <PageHeader title={copy.contributeTitle} lede={copy.contributeLede}>
        <StaleNotice studio={studio} />
      </PageHeader>
      <PausedNotice studio={studio} />
      {env.stripePaymentLinkUrl === '' ? (
        <p>{copy.contributeUnavailable}</p>
      ) : (
        <>
          <a className="choice choice-primary" href={env.stripePaymentLinkUrl}>
            <span className="choice-title">{copy.pickForMe}</span>
            <span className="choice-body">{copy.pickForMeBody}</span>
          </a>

          <h2 className="choices-heading">{copy.orPickACard}</h2>
          <Guarded studio={studio}>
            {(snapshot) => {
              const fundable = groupCards(snapshot.cards).fund.filter(canFund);
              if (fundable.length === 0) return <p className="muted">{copy.noFundableCards}</p>;
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
          <p className="muted small">{copy.split}</p>
        </>
      )}
    </main>
  );
}
