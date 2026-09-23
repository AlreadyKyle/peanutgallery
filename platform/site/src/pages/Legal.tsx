import { TextPage } from '../components/TextPage';
import { siteEnv } from '../lib/env';
import { legal } from '../lib/legal';

// Terms, Privacy, Refunds and Contact: plain text pages linked from the footer. Kernel, like every
// string they show, which is in legal.ts (docs/specs/board-site.md); the legal pages end with the
// date they last changed.

function Updated() {
  return <p className="muted small">{legal.legalUpdated}</p>;
}

export function Terms() {
  return <TextPage name="terms" page={legal.terms} footer={<Updated />} />;
}

export function Privacy() {
  return <TextPage name="privacy" page={legal.privacy} footer={<Updated />} />;
}

export function Refunds() {
  return <TextPage name="refunds" page={legal.refunds} footer={<Updated />} />;
}

export function Contact() {
  const env = siteEnv();
  const extra = env.discordInvite === '' ? [] : [legal.contact.discordSection];
  return <TextPage name="contact" page={legal.contact} extra={extra} />;
}
