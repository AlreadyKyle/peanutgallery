import type { ReactNode } from 'react';
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
 * set the title at its foot, then jump when the words arrive. `reserve` is the status the page expects
 * to show once the read answers, drawn hidden in the same place, so the line takes that status's room
 * and nothing under it moves when it arrives.
 */
function LoadingLine({ reserve }: { reserve?: ReactNode }) {
  const line = (
    <p className="muted" role="status" aria-busy="true">
      {legal.termsLoading}
    </p>
  );
  if (reserve === undefined) return line;
  return (
    <div className="terms-loading">
      {line}
      <div className="terms-reserve" aria-hidden="true">
        {reserve}
      </div>
    </div>
  );
}

// A sample time for the room an earlier version's status line takes while the read runs: the dates
// it shows are the same length whatever they are.
const SAMPLE_POSTED_AT = '2026-09-14T13:05:00Z';

/** An earlier version's status: when it was in force, and the link to the version in force now. */
function PastLines({ kind, n, from, until }: { kind: Kind; n: string; from: string; until: string }) {
  return (
    <>
      <p>{fill(legal.termsPastLine, { n, from: formatPostedAt(from), until: formatPostedAt(until) })}</p>
      <p>
        <Link className="target" to={`/${kind}`} tabIndex={-1}>
          {legal.termsCurrentLink}
        </Link>
      </p>
    </>
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
  if (view.state === 'loading') {
    // A version older than the newest in this build is most likely an earlier one: hold its two lines' room.
    const past = at < NEWEST_TERMS.version;
    const reserve = past ? <PastLines kind={kind} n={String(at)} from={SAMPLE_POSTED_AT} until={SAMPLE_POSTED_AT} /> : undefined;
    return <TextPage name={kind} page={page} title={title} version={at} status={<LoadingLine reserve={reserve} />} />;
  }
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
