import { Link, useParams } from 'react-router-dom';
import { NotFound } from '../components/NotFound';
import { PageHeader } from '../components/PageHeader';
import { LinkedText, TextPage } from '../components/TextPage';
import { siteEnv } from '../lib/env';
import { formatPostedAt } from '../lib/format';
import { legal } from '../lib/legal';
import { termsView, usePostedTerms, versionView, type EarlierVersion } from '../lib/terms';
import { NEWEST_TERMS, type TextDoc } from '../lib/terms-versions';

// Terms, Privacy, Refunds and Contact: plain text pages linked from the footer. Kernel, like every
// string they show, which is in legal.ts and terms-versions.ts (docs/specs/board-site.md,
// docs/specs/legal-copy.md). The Terms and the Refunds page are one numbered version: each shows the
// version in force and when it took effect, lists the earlier ones, and /terms/n and /refunds/n show
// one posted version. Privacy ends with the date it last changed.

type Kind = 'terms' | 'refunds';

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (token, key: string) => values[key] ?? token);
}

function Unconfirmed() {
  return (
    <p className="notice">
      <LinkedText text={legal.termsUnconfirmed} />
    </p>
  );
}

/** While the versions read runs: the page's title and lede, then one line in place of the words. */
function Loading({ title, page }: { title: string; page: TextDoc }) {
  return (
    <main className="text-page">
      <div className="band">
        <PageHeader title={title} lede={page.lede} />
      </div>
      <div className="band">
        <p className="muted" role="status" aria-busy="true">
          {legal.termsLoading}
        </p>
      </div>
    </main>
  );
}

function EarlierVersions({ kind, earlier }: { kind: Kind; earlier: readonly EarlierVersion[] }) {
  const id = `${kind}-earlier`;
  return (
    <section className="section" aria-labelledby={id}>
      <h2 id={id}>{legal.termsEarlier}</h2>
      <ul className="rules">
        {earlier.map(({ entry, from, until }) => (
          <li key={entry.version}>
            <Link className="target" to={`/${kind}/${entry.version}`}>
              {fill(legal.termsEarlierItem, { n: String(entry.version), from: formatPostedAt(from), until: formatPostedAt(until) })}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** /terms and /refunds: the newest version that is posted and in this build. */
function CurrentVersion({ kind }: { kind: Kind }) {
  const view = termsView(usePostedTerms());
  if (view.state === 'loading') return <Loading title={NEWEST_TERMS[kind].title} page={NEWEST_TERMS[kind]} />;
  const page = view.entry[kind];
  if (view.state === 'unconfirmed') return <TextPage name={kind} page={page} status={<Unconfirmed />} />;
  const since = <p>{fill(legal.termsVersionLine, { n: String(view.entry.version), time: formatPostedAt(view.since) })}</p>;
  const footer = view.earlier.length === 0 ? undefined : <EarlierVersions kind={kind} earlier={view.earlier} />;
  return <TextPage name={kind} page={page} status={since} footer={footer} />;
}

/** /terms/n and /refunds/n: one posted version, with when it was in force. */
function OneVersion({ kind }: { kind: Kind }) {
  const { version } = useParams();
  const view = versionView(version, usePostedTerms());
  if (view.state === 'not-found') return <NotFound />;
  const page = view.entry[kind];
  const title = fill(legal.termsVersionTitle, { title: page.title, n: String(view.entry.version) });
  if (view.state === 'loading') return <Loading title={title} page={page} />;
  if (view.state === 'unconfirmed') return <TextPage name={kind} page={page} title={title} status={<Unconfirmed />} />;
  const n = String(view.entry.version);
  const status =
    view.state === 'current' ? (
      <p>{fill(legal.termsVersionLine, { n, time: formatPostedAt(view.since) })}</p>
    ) : (
      <>
        <p>{fill(legal.termsPastLine, { n, from: formatPostedAt(view.from), until: formatPostedAt(view.until) })}</p>
        <p>
          <Link className="target" to={`/${kind}`}>
            {legal.termsCurrentLink}
          </Link>
        </p>
      </>
    );
  return <TextPage name={kind} page={page} title={title} status={status} />;
}

export function Terms() {
  return <CurrentVersion kind="terms" />;
}

export function Refunds() {
  return <CurrentVersion kind="refunds" />;
}

export function TermsVersion() {
  return <OneVersion kind="terms" />;
}

export function RefundsVersion() {
  return <OneVersion kind="refunds" />;
}

export function Privacy() {
  return <TextPage name="privacy" page={legal.privacy} footer={<p className="muted small">{legal.privacyUpdated}</p>} />;
}

export function Contact() {
  const env = siteEnv();
  const extra = env.discordInvite === '' ? [] : [legal.contact.discordSection];
  return <TextPage name="contact" page={legal.contact} extra={extra} />;
}
