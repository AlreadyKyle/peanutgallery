import { TextPage } from '../components/TextPage';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';

// Terms, Privacy, Refunds and Contact: plain text pages linked from the footer. Every string is in
// copy.ts; the legal pages end with the date they last changed.

function Updated() {
  return <p className="muted small">{copy.legalUpdated}</p>;
}

export function Terms() {
  return <TextPage name="terms" page={copy.terms} footer={<Updated />} />;
}

export function Privacy() {
  return <TextPage name="privacy" page={copy.privacy} footer={<Updated />} />;
}

export function Refunds() {
  return <TextPage name="refunds" page={copy.refunds} footer={<Updated />} />;
}

export function Contact() {
  const env = siteEnv();
  const extra = env.discordInvite === '' ? [] : [copy.contact.discordSection];
  return <TextPage name="contact" page={copy.contact} extra={extra} />;
}
