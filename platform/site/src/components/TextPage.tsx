import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { legal } from '../lib/legal';
import { PageHeader } from './PageHeader';

export type TextSection = {
  readonly heading: string;
  readonly paragraphs: readonly string[];
};

const TOKENS = /(\{email\}|\{refunds\}|\{terms\}|\{discord\})/;

/**
 * A paragraph from legal.ts or terms-versions.ts with its {email}, {refunds}, {terms} and {discord}
 * tokens turned into links. Kernel (docs/specs/board-site.md): it renders the legal pages and the
 * agreement lines before checkout.
 */
export function LinkedText({ text }: { text: string }) {
  const env = siteEnv();
  return (
    <>
      {text.split(TOKENS).map((part, index) => {
        if (part === '{email}') {
          return (
            <a key={index} href={`mailto:${legal.contactEmail}`}>
              {legal.contactEmail}
            </a>
          );
        }
        if (part === '{refunds}') {
          return (
            <Link key={index} to="/refunds">
              {legal.refundsPageLink}
            </Link>
          );
        }
        if (part === '{terms}') {
          return (
            <Link key={index} to="/terms">
              {legal.footerLinks.terms}
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
 * The text-page layout: one h1 and a lede on the first band (the signal plate), then sections that
 * each open with an h2 on the second (paper) band, all held to the reading measure. `name` prefixes
 * the heading ids; `extra` sections follow the page's own. `status` sits under the lede on the first
 * band (the Terms version line); `title` replaces the page's own title (a Terms version's page).
 */
export function TextPage({
  name,
  page,
  title,
  extra = [],
  status,
  footer,
}: {
  name: string;
  page: { readonly title: string; readonly lede: string; readonly sections: readonly TextSection[] };
  title?: string;
  extra?: readonly TextSection[];
  status?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="text-page">
      <div className="band">
        <PageHeader title={title ?? page.title} lede={page.lede}>
          {status}
        </PageHeader>
      </div>
      <div className="band">
        {[...page.sections, ...extra].map((section, index) => (
          <TextBlock key={section.heading} id={`${name}-${index + 1}`} section={section} />
        ))}
        {footer}
      </div>
    </main>
  );
}
