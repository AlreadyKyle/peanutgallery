import type { Card } from './source';

// Which cards take money and the one address money goes to: the Payment Link from netlify.toml
// (lib/env.ts), with the card's id as client_reference_id, which the webhook credits to that card.
// Kernel (platform/gate/kernel-paths.txt, docs/specs/board-site.md); the gate's payment-host scan
// also fails a build that carries any other payment address.

export function isFullyFunded(card: Card): boolean {
  return card.funding_target_usd > 0 && card.funded_usd >= card.funding_target_usd;
}

/** A card takes money while it is a goal card with a target its bar has not reached. */
export function canFund(card: Card): boolean {
  return card.shape === 'goal' && card.funding_target_usd > 0 && !isFullyFunded(card);
}

/** The Payment Link with client_reference_id set to the card id, which the webhook credits. */
export function fundLink(base: string, id: string): string {
  const joiner = base.includes('?') ? '&' : '?';
  return `${base}${joiner}client_reference_id=${encodeURIComponent(id)}`;
}
