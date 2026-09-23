// Whether an API error says the studio's key cannot spend, and why. Such an error is the studio's, not
// the card's: every session after it fails the same way until the board acts or the month turns, so
// the session that meets it pauses the studio and its card instead of rejecting the card
// (pipeline.ts). The Managed Agents adapter passes the error text of a failed session create or
// session.error event as an error event, and session.ts reads it here too.
//
// credit    the Console credit ran out, or the Console spend limit the board set was reached. The
//           board buys credit or raises the limit.
// tier_cap  the organisation reached the monthly cap of its Anthropic usage tier. Buying credit does
//           not help; it clears when the month turns or Anthropic raises the tier (docs/specs/
//           scale-launch.md).
export type SpendRefusal = 'credit' | 'tier_cap';

// The usage tier's cap answers HTTP 429 rate_limit_error with "You have reached your API usage limits:
// your organization has crossed its monthly API usage threshold..." and the error code
// enforced_spend_limit_reached, and sends no retry-after (platform.claude.com/docs/en/api/rate-limits).
// Either signal alone is enough.
const TIER_CAP: readonly RegExp[] = [/\benforced_spend_limit_reached\b/, /reached your API usage limits/i];

const CREDIT_EXHAUSTED: readonly RegExp[] = [
  // "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to
  // upgrade or purchase credits."
  /credit balance is too low/i,
  /purchase credits/i,
  // "You have reached your specified API usage limits." (the Console spend limit), and its workspace
  // form, "You have reached your specified workspace API usage limits."
  /reached your specified (?:workspace )?(?:api )?usage limit/i,
  /\bbilling_error\b/i,
];

// The tier cap is checked first: its answer can also carry a billing type, and only the tier cap
// cannot be cleared by buying credit.
export function spendRefusal(text: string): SpendRefusal | null {
  if (TIER_CAP.some((pattern) => pattern.test(text))) return 'tier_cap';
  if (CREDIT_EXHAUSTED.some((pattern) => pattern.test(text))) return 'credit';
  return null;
}

// The failing check a card pauses with for each refusal.
export const REFUSAL_CHECK: Record<SpendRefusal, string> = {
  credit: 'console_credit',
  tier_cap: 'usage_tier_cap',
};
