import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { splitSentence } from '../components/Funding';
import { copy } from '../lib/copy';
import { faq } from '../lib/faq';
import { legal } from '../lib/legal';
import { RARITY_ODDS } from '../lib/rarity';
import { useSignInOpen } from '../lib/sign-in';
import { XP_PER_DOLLAR } from '../lib/xp';

// /faq (docs/specs/final-state.md): every question a visitor asks, answered plainly. Money is said
// once, by the kernel: where money goes and the fixed rules are read from legal.ts and payment.ts
// here, never restated in copy.ts, and refunds link the Refunds page. Rarity's shares and XP's rate
// come from the code that applies them (lib/rarity.ts, lib/xp.ts), so the page cannot drift from it.
// While sign-in is closed, an answer about a profile reads its closed words and drops a link to a page
// that needs one, so nothing points at a form that cannot work.

type Answer = {
  readonly q: string;
  readonly a: readonly string[];
  readonly aClosed?: readonly string[];
  readonly link?: { readonly to: string; readonly label: string; readonly signIn?: boolean };
};

function percent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function fill(text: string): string {
  return text
    .replace('{common}', percent(RARITY_ODDS.common))
    .replace('{uncommon}', percent(RARITY_ODDS.uncommon))
    .replace('{rare}', percent(RARITY_ODDS.rare))
    .replace('{legendary}', percent(RARITY_ODDS.legendary))
    .replace('{xp}', String(XP_PER_DOLLAR));
}

function Item({ item, id, children }: { item: Answer; id: string; children?: React.ReactNode }) {
  const open = useSignInOpen();
  const lines = open || item.aClosed === undefined ? item.a : item.aClosed;
  return (
    <div className="faq-item" id={id}>
      <h3>{item.q}</h3>
      {lines.map((line) => (
        <p key={line}>{fill(line)}</p>
      ))}
      {children}
      {item.link === undefined || (item.link.signIn === true && !open) ? null : (
        <p>
          <Link to={item.link.to}>{item.link.label}</Link>
        </p>
      )}
    </div>
  );
}

/** Where the money goes: the kernel's own sentences and fixed rules, word for word. */
function MoneyAnswer() {
  return (
    <>
      <p>
        {splitSentence()} {legal.agentShareLine} {legal.notDonations}
      </p>
      <p>{legal.fixedRulesIntro}</p>
      <ul className="plain-list">
        {legal.fixedRules.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
      <p>{legal.usdNote}</p>
    </>
  );
}

export function Faq() {
  return (
    <main className="wide sheet">
      <div className="band">
        <PageHeader title={faq.title} lede={faq.lede} />
      </div>
      <div className="band">
        <nav className="faq-index" aria-label={faq.indexLabel}>
          <ul>
            {faq.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title}</a>
              </li>
            ))}
          </ul>
        </nav>
        {faq.sections.map((section) => (
          <section key={section.id} className="section faq-section" aria-labelledby={section.id}>
            <h2 id={section.id}>{section.title}</h2>
            {section.items.map((item, i) => (
              <Item key={item.q} item={item} id={`${section.id}-${i}`}>
                {section.id === 'money' && i === 1 ? <MoneyAnswer /> : null}
              </Item>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
