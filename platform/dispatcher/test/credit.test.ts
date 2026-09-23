import { describe, expect, it } from 'vitest';
import { REFUSAL_CHECK, spendRefusal } from '../src/credit.js';

// The tier cap's answer as the Anthropic SDK words an APIError: the status, then the JSON body. The
// rate-limits page names the message and the error code; each is tested on its own below, so the
// test does not depend on where in the body the code sits.
const TIER_MESSAGE = 'You have reached your API usage limits: your organization has crossed its monthly API usage threshold.';
const TIER_429 = `429 ${JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: TIER_MESSAGE, details: { error_code: 'enforced_spend_limit_reached' } } })}`;

describe('spendRefusal', () => {
  it('reads the API errors for an empty Console balance and a reached Console limit as credit', () => {
    expect(spendRefusal('Credit balance is too low')).toBe('credit');
    expect(spendRefusal('API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}')).toBe('credit');
    expect(spendRefusal('You have reached your specified API usage limits. You will regain access on the first of the month.')).toBe('credit');
    expect(spendRefusal('{"type":"error","error":{"type":"billing_error","message":"billing problem"}}')).toBe('credit');
  });

  it('reads the workspace form of the Console limit as credit', () => {
    expect(spendRefusal('400 {"type":"error","error":{"type":"invalid_request_error","message":"You have reached your specified workspace API usage limits. You will regain access on the first of the month."}}')).toBe('credit');
  });

  it("reads the usage tier's monthly cap as tier_cap, by its message or its error code", () => {
    expect(spendRefusal(TIER_429)).toBe('tier_cap');
    expect(spendRefusal(`the Managed Agents session could not be created: ${TIER_429}`)).toBe('tier_cap');
    expect(spendRefusal(TIER_MESSAGE)).toBe('tier_cap');
    expect(spendRefusal('429 {"type":"error","error":{"type":"rate_limit_error","message":"limit"},"error_code":"enforced_spend_limit_reached"}')).toBe('tier_cap');
    // A session.error event as the managed adapter writes it.
    expect(spendRefusal(`session error: ${JSON.stringify({ type: 'billing_error', message: TIER_MESSAGE, retry_status: { type: 'terminal' } })}`)).toBe('tier_cap');
  });

  it('leaves other API errors, an ordinary rate limit included, to fail the card as before', () => {
    expect(spendRefusal('API Error: 529 overloaded')).toBeNull();
    expect(spendRefusal('API Error: 500 internal server error')).toBeNull();
    expect(spendRefusal('429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}')).toBeNull();
    expect(spendRefusal('The gatherer baseCost is now 11.')).toBeNull();
  });

  it('names the failing check a card pauses with', () => {
    expect(REFUSAL_CHECK).toEqual({ credit: 'console_credit', tier_cap: 'usage_tier_cap' });
  });
});
