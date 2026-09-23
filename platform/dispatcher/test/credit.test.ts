import { describe, expect, it } from 'vitest';
import { creditExhausted } from '../src/credit.js';

describe('creditExhausted', () => {
  it('reads the API errors for an empty Console balance and a reached Console limit', () => {
    expect(creditExhausted('Credit balance is too low')).toBe(true);
    expect(creditExhausted('API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}')).toBe(true);
    expect(creditExhausted('You have reached your specified API usage limits. You will regain access on the first of the month.')).toBe(true);
    expect(creditExhausted('{"type":"error","error":{"type":"billing_error","message":"billing problem"}}')).toBe(true);
  });

  it('leaves other API errors to fail the card as before', () => {
    expect(creditExhausted('API Error: 529 overloaded')).toBe(false);
    expect(creditExhausted('API Error: 500 internal server error')).toBe(false);
    expect(creditExhausted('The gatherer baseCost is now 11.')).toBe(false);
  });
});
