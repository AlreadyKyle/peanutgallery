import { Link } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { MoreLink } from '../components/MoreLink';
import { PageHeader } from '../components/PageHeader';
import { Stat } from '../components/Stat';
import { copy } from '../lib/copy';
import { formatDay, formatInteger } from '../lib/format';
import { legal } from '../lib/legal';
import { MAX_PAGES, useWeek, type Week as WeekFigures, type WeekCard } from '../lib/week';

// /week (QUEUE Q-053): this week, in public. The New York week so far, from the public feed alone
// (lib/week.ts): the players it names, the contributions, and the cards opened, funded and shipped,
// with the funded and shipped cards listed and linked. The same numbers fill the weekly report.
// When the feed does not answer, the page says so and shows no figure.

const words = copy.week;
const FIGURES = ['players', 'contributions', 'opened', 'funded', 'shipped'] as const;

function figure(week: WeekFigures, name: (typeof FIGURES)[number]): number {
  if (name === 'funded') return week.funded.length;
  if (name === 'shipped') return week.shipped.length;
  return week[name];
}

function Cards({ id, title, cards, none, more }: { id: string; title: string; cards: readonly WeekCard[]; none: string; more?: { to: string; label: string } }) {
  return (
    <section className="section" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {cards.length === 0 ? (
        <>
          <p className="muted">{none}</p>
          {more === undefined ? null : (
            <p className="more">
              <MoreLink to={more.to}>{more.label}</MoreLink>
            </p>
          )}
        </>
      ) : (
        <ul className="rows">
          {cards.map((card) => (
            <li key={card.id} data-card={card.id}>
              <Link to={`/card/${card.id}`}>{card.title}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Week() {
  const state = useWeek();
  return (
    <main className="title-stays sheet">
      <div className="band">
        <PageHeader title={words.title} lede={words.lede} />
      </div>
      <div className="band">
        <section className="section" aria-labelledby="week-figures">
          <h2 id="week-figures">{words.figuresTitle}</h2>
          {state.state === 'loading' ? (
            <p className="muted" aria-busy="true">
              {words.loading}
            </p>
          ) : state.state === 'unavailable' ? (
            <EmptyState line={legal.partUnavailable} next={{ to: '/ledger', label: copy.emptyState.ledger }} unavailable />
          ) : (
            <>
              <dl className="stats">
                {FIGURES.map((name) => (
                  <Stat key={name} label={words.figures[name].label} description={words.figures[name].description} value={formatInteger(figure(state.week, name))} />
                ))}
              </dl>
              <p className="muted">{words.since.replace('{date}', formatDay(state.week.day))}</p>
              {state.week.complete ? null : <p className="muted">{words.partial.replace('{n}', formatInteger(MAX_PAGES * 30))}</p>}
            </>
          )}
        </section>
        {state.state === 'ready' ? (
          <>
            <Cards id="week-shipped" title={words.shippedTitle} cards={state.week.shipped} none={words.noneShipped} />
            <Cards id="week-funded" title={words.fundedTitle} cards={state.week.funded} none={words.noneFunded} more={{ to: '/contribute', label: words.fundLink }} />
          </>
        ) : null}
        <div className="prose">
          <p>{words.sources}</p>
          <p className="more">
            <MoreLink to="/ledger">{words.ledgerLink}</MoreLink>
          </p>
          <p className="more">
            <MoreLink to="/reports">{words.reportsLink}</MoreLink>
          </p>
        </div>
      </div>
    </main>
  );
}
