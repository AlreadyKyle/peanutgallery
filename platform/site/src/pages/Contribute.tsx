import { FundingBar, fundingCaption } from '../components/Funding';
import { Guarded } from '../components/Guarded';
import { PageHeader } from '../components/PageHeader';
import { StaleNotice } from '../components/StaleNotice';
import { LinkedText } from '../components/TextPage';
import { siteEnv } from '../lib/env';
import { legal } from '../lib/legal';
import { useId, useState } from 'react';
import { DEFAULT_STUDIO_PCT, fundableCards, fundLink, INCIDENT_PCT, nextInLine, noCardTakesMoney, RESERVE_PCT, snapStudioPct } from '../lib/payment';
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

function fill(text: string, values: Record<string, number>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? String(values[key]) : whole));
}

/**
 * The split slider (docs/specs/split-slider.md): one native range input, so the keyboard, touch and
 * screen readers work as they do everywhere, stepping by ten through the eleven splits the webhook
 * allows. Its value is the agents' percent, left to right; the studio has the rest. Every checkout
 * link on the page carries the choice on client_reference_id. The reserve and the emergency fund
 * are said as fixed beside it, and nothing on the page moves them.
 */
function SplitSlider({ studioPct, onChange }: { studioPct: number; onChange: (pct: number) => void }) {
  const id = useId();
  const agents = 100 - studioPct;
  const values = { agents, studio: studioPct, reserve: RESERVE_PCT, incident: INCIDENT_PCT };
  return (
    <section className="split-slider" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{legal.splitHeading}</h2>
      <p>{legal.splitIntro}</p>
      <label className="split-label" htmlFor={`${id}-range`}>
        {legal.splitLabel}
      </label>
      <div className="split-ends">
        <span className="split-agents">{fill(legal.splitAgents, values)}</span>
        <span className="split-studio">{fill(legal.splitStudio, values)}</span>
      </div>
      <input
        id={`${id}-range`}
        className="split-range"
        type="range"
        min={0}
        max={100}
        step={10}
        value={agents}
        aria-valuetext={fill(legal.splitValueText, values)}
        onChange={(event) => onChange(snapStudioPct(100 - Number(event.currentTarget.value)))}
      />
      <p className="muted small split-fixed">{fill(legal.splitFixed, values)}</p>
    </section>
  );
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
  const [studioPct, setStudioPct] = useState(DEFAULT_STUDIO_PCT);
  return (
    <main className="wide">
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
            <SplitSlider studioPct={studioPct} onChange={setStudioPct} />
            <a className="choice choice-primary" href={fundLink(env.stripePaymentLinkUrl, null, studioPct)}>
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
                          <a className="choice" href={fundLink(env.stripePaymentLinkUrl, card.id, studioPct)}>
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
