import { Link } from 'react-router-dom';
import { formatDate, formatDay, formatInteger, formatUsd } from '../lib/format';
import { legal } from '../lib/legal';
import type { Report, ReportCard } from '../lib/reports-source';
import { supporterName } from './Supporters';

// Kernel (docs/specs/studio-reports.md): one weekly report in its fixed template, from its facts
// alone. The week as the heading; the four figures as facts rows (cards shipped, spent from
// contributions, new supporters, open for funding when published); each shipped card as a rail row
// (the day it shipped, its title linking its own page, what it cost from contributions and its first
// supporters by number); then the first cards in line to fund. Money only through the formatter, and
// no amount per supporter, name or email: the facts hold none.

/** How many supporters a shipped row names before "and n more". */
export const NAMED_SUPPORTERS = 3;

/** "$0.29 from contributions · funded by Supporter 1, Founding supporter 2 and 3 more"; the cost left out at $0.00, the supporters with none. */
export function shippedMeta(card: ReportCard): string | null {
  const parts: string[] = [];
  if (Math.round(card.cost_usd * 100) > 0) parts.push(legal.reportFacts.cost.replace('{usd}', formatUsd(card.cost_usd)));
  const named = [...card.supporters].sort((a, b) => a.number - b.number).slice(0, NAMED_SUPPORTERS).map(supporterName);
  if (named.length > 0) {
    const more = Math.max(0, card.supporter_count - named.length);
    const names =
      more > 0
        ? `${named.join(', ')} ${legal.supportersMore.replace('{n}', formatInteger(more))}`
        : named.length === 1
          ? named[0]!
          : `${named.slice(0, -1).join(', ')} and ${named.at(-1)!}`;
    parts.push(legal.reportFacts.fundedBy.replace('{names}', names));
  }
  return parts.length === 0 ? null : parts.join(' · ');
}

export function ReportFacts({ report }: { report: Report }) {
  const words = legal.reportFacts;
  const facts = report.facts;
  const id = `report-${report.week_start}`;
  return (
    <section className="section report" aria-labelledby={id} data-report={report.week_start}>
      <h2 id={id}>{words.weekOf.replace('{day}', formatDay(report.week_start))}</h2>
      <dl className="facts">
        <div data-fact="shipped">
          <dt>{words.shipped}</dt>
          <dd>{formatInteger(facts.shipped_count)}</dd>
        </div>
        <div data-fact="spent">
          <dt>{words.spent}</dt>
          <dd>{formatUsd(facts.spend_usd)}</dd>
        </div>
        <div data-fact="new-supporters">
          <dt>{words.newSupporters}</dt>
          <dd>{formatInteger(facts.new_supporters)}</dd>
        </div>
        <div data-fact="open">
          <dt>{words.open}</dt>
          <dd>{formatInteger(facts.open_count)}</dd>
        </div>
      </dl>
      {facts.shipped.length === 0 ? null : (
        <>
          <h3>{words.shippedHeading}</h3>
          <ul className="rows rail">
            {facts.shipped.map((card) => {
              const meta = shippedMeta(card);
              return (
                <li key={card.id} data-shipped={card.id}>
                  <span className="row-time">{formatDate(card.live_at)}</span>
                  <div className="row-body">
                    <p className="row-title">
                      <Link to={`/card/${card.id}`}>{card.title}</Link>
                    </p>
                    {meta === null ? null : <p className="row-meta">{meta}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {facts.open_first.length === 0 ? null : (
        <>
          <h3>{words.firstInLine}</h3>
          <ul className="rows">
            {facts.open_first.map((card) => (
              <li key={card.id} data-open={card.id}>
                <Link to={`/card/${card.id}`}>{card.title}</Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
