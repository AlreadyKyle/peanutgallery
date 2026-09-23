import { Link, useParams } from 'react-router-dom';
import { NotFound } from '../components/NotFound';
import { LinkedText, TextPage } from '../components/TextPage';
import { siteEnv } from '../lib/env';
import { formatPostedAt } from '../lib/format';
import { legal } from '../lib/legal';
import { termsView, usePostedTerms, versionView, type EarlierVersion } from '../lib/terms';
import { NEWEST_TERMS } from '../lib/terms-versions';

// Terms, Privacy, Refunds and Contact: plain text pages linked from the footer. Kernel, like every
// string they show, which is in legal.ts and terms-versions.ts (docs/specs/board-site.md,
// docs/specs/legal-copy.md). The Terms and the Refunds page are one numbered version: each shows the
// version in force and when it took effect, lists the earlier ones, and /terms/n and /refunds/n show
// one posted version. Privacy ends with the date it last changed.

type Kind = 'terms' | 'refunds';

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (token, key: string) => values[key] ?? token);
}

// .notice lays out the pause bars and the text side by side, so the text and its link go in one span.
function Unconfirmed() {
  return (
    <p className="notice">
      <span>
        <LinkedText text={legal.termsUnconfirmed} />
      </span>
    </p>
  );
}

/**
 * While the versions read runs, the page is drawn whole with the words it expects (the newest bundled
 * version, or version n) and this line under the lede in place of the version line, so only this line
 * changes when the read answers. A short loading page would let the signal plate fill the window and
 * set the title at its foot, then jump when the words arrive.
 */
function LoadingLine() {
  return (
    <p className="muted" role="status" aria-busy="true">
      {legal.termsLoading}
    </p>
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
  if (view.state === 'loading') return <TextPage name={kind} page={NEWEST_TERMS[kind]} status={<LoadingLine />} />;
  const page = view.entry[kind];
  if (view.state === 'unconfirmed') return <TextPage name={kind} page={page} status={<Unconfirmed />} />;
  const since = <p>{fill(legal.termsVersionLine, { n: String(view.entry.version), time: formatPostedAt(view.since) })}</p>;
  const footer = view.earlier.length === 0 ? undefined : <EarlierVersions kind={kind} earlier={view.earlier} />;
  return <TextPage name={kind} page={page} status={since} footer={footer} />;
}

/**
 * /terms/n and /refunds/n: one posted version, with when it was in force. Its {terms} and {refunds}
 * links go to version n's pages, the words that applied with it.
 */
function OneVersion({ kind }: { kind: Kind }) {
  const { version } = useParams();
  const view = versionView(version, usePostedTerms());
  if (view.state === 'not-found') return <NotFound />;
  const page = view.entry[kind];
  const at = view.entry.version;
  const title = fill(legal.termsVersionTitle, { title: page.title, n: String(at) });
  if (view.state === 'loading') return <TextPage name={kind} page={page} title={title} version={at} status={<LoadingLine />} />;
  if (view.state === 'unconfirmed') return <TextPage name={kind} page={page} title={title} version={at} status={<Unconfirmed />} />;
  const n = String(at);
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
  return <TextPage name={kind} page={page} title={title} version={at} status={status} />;
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
