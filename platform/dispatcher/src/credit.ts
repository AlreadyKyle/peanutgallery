// Whether an API error says the studio's Console credit or its Console spend limit has run out. Such
// an error is the studio's, not the card's: every session after it fails the same way until the board
// buys credit or raises the limit, so the session that meets it pauses the studio and its card instead
// of rejecting the card (pipeline.ts). The Managed Agents adapter passes the error text of a failed
// session create or session.error event as an error event, and session.ts reads it here too.
const CREDIT_EXHAUSTED: readonly RegExp[] = [
  // "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to
  // upgrade or purchase credits."
  /credit balance is too low/i,
  /purchase credits/i,
  // "You have reached your specified API usage limits." (the Console spend limit)
  /reached your specified (?:api )?usage limit/i,
  /\bbilling_error\b/i,
];

export function creditExhausted(text: string): boolean {
  return CREDIT_EXHAUSTED.some((pattern) => pattern.test(text));
}
