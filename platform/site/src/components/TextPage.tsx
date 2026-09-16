import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { PageHeader } from './PageHeader';

export type TextSection = {
  readonly heading: string;
  readonly paragraphs: readonly string[];
};

const TOKENS = /(\{email\}|\{refunds\}|\{discord\})/;

/** A paragraph from copy.ts with its {email}, {refunds} and {discord} tokens turned into links. */
export function LinkedText({ text }: { text: string }) {
  const env = siteEnv();
  return (
    <>
      {text.split(TOKENS).map((part, index) => {
        if (part === '{email}') {
          return (
            <a key={index} href={`mailto:${copy.contactEmail}`}>
              {copy.contactEmail}
            </a>
          );
        }
        if (part === '{refunds}') {
          return (
            <Link key={index} to="/refunds">
              {copy.refundsPageLink}
            </Link>
          );
        }
        if (part === '{discord}') {
          return (
            <a key={index} href={env.discordInvite}>
              {copy.discord}
            </a>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}

function TextBlock({ id, section }: { id: string; section: TextSection }) {
  return (
    <section className="section" aria-labelledby={id}>
      <h2 id={id}>{section.heading}</h2>
      {section.paragraphs.map((paragraph) => (
        <p key={paragraph}>
          <LinkedText text={paragraph} />
        </p>
      ))}
    </section>
  );
}

/**
 * The text-page layout: one h1 and a lede, then sections that each open with an h2, all held to the
 * reading measure. `name` prefixes the heading ids; `extra` sections follow the page's own.
 */
export function TextPage({
  name,
  page,
  extra = [],
  footer,
}: {
  name: string;
  page: { readonly title: string; readonly lede: string; readonly sections: readonly TextSection[] };
  extra?: readonly TextSection[];
  footer?: ReactNode;
}) {
  return (
    <main className="text-page">
      <PageHeader title={page.title} lede={page.lede} />
      {[...page.sections, ...extra].map((section, index) => (
        <TextBlock key={section.heading} id={`${name}-${index + 1}`} section={section} />
      ))}
      {footer}
    </main>
  );
}
