// Pure helpers for the Stripe webhook. No I/O, no environment.
// The split arithmetic itself (reserve, studio, agents, incident) lives in the
// apply_contribution RPC; this module only turns a checkout session into the
// RPC's inputs.

/** Dropdown values of the Payment Link's `split` field, mapped to the studio percent. */
export const SPLIT_MAP: Readonly<Record<string, number>> = {
  "1000": 0,
  "9010": 10,
  "8020": 20,
  "7030": 30,
  "6040": 40,
  "5050": 50,
  "4060": 60,
  "3070": 70,
  "2080": 80,
  "1090": 90,
  "0100": 100,
};

export const DEFAULT_STUDIO_PCT = 20;
export const DISPLAY_NAME_MAX = 24;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Studio percent for a dropdown value. Missing → default; unknown → throws. */
export function mapSplit(value: string | null | undefined): number {
  if (value === null || value === undefined || value === "") {
    return DEFAULT_STUDIO_PCT;
  }
  const pct = SPLIT_MAP[value];
  if (pct === undefined) {
    throw new Error(`Unknown split value: ${value}`);
  }
  return pct;
}

export function roundUsd(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Converts a balance transaction fee to USD. Stripe reports the fee in the
 * settlement currency in its smallest unit; when that currency is not USD the
 * transaction carries the exchange rate from the presentment currency, so the
 * presentment-currency fee is fee / exchange_rate.
 */
export function feeToUsd(
  fee: number,
  currency: string,
  exchangeRate: number | null | undefined,
): number {
  if (!Number.isFinite(fee) || fee < 0) {
    throw new Error(`Invalid balance transaction fee: ${fee}`);
  }
  if (currency.toLowerCase() === "usd") {
    return roundUsd(fee / 100);
  }
  if (
    exchangeRate === null || exchangeRate === undefined || !(exchangeRate > 0)
  ) {
    throw new Error(`Balance transaction in ${currency} has no exchange rate`);
  }
  return roundUsd(fee / 100 / exchangeRate);
}

export interface Amounts {
  amount_usd: number;
  fee_usd: number;
  net_usd: number;
}

/** amount_total is in cents; feeUsd is already in USD. */
export function computeAmounts(
  amountTotalCents: number,
  feeUsd: number,
): Amounts {
  if (!Number.isInteger(amountTotalCents) || amountTotalCents <= 0) {
    throw new Error(`Invalid amount_total: ${amountTotalCents}`);
  }
  if (!Number.isFinite(feeUsd) || feeUsd < 0) {
    throw new Error(`Invalid fee: ${feeUsd}`);
  }
  const amountUsd = roundUsd(amountTotalCents / 100);
  const fee = roundUsd(feeUsd);
  if (fee > amountUsd) {
    throw new Error(`Fee ${fee} exceeds amount ${amountUsd}`);
  }
  return {
    amount_usd: amountUsd,
    fee_usd: fee,
    net_usd: roundUsd(amountUsd - fee),
  };
}

/** Trims, strips control characters, and caps the display name; empty → null. */
export function sanitizeDisplayName(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue;
    out += ch;
  }
  out = out.trim();
  if (out.length === 0) return null;
  return Array.from(out).slice(0, DISPLAY_NAME_MAX).join("");
}

export interface ContributorSource {
  email?: string | null;
  customerId?: string | null;
  sessionId: string;
}

/** The string that is hashed into contributor_id: lowercased email, else customer id, else session id. */
export function contributorSource(source: ContributorSource): string {
  const email = source.email?.trim().toLowerCase();
  if (email) return email;
  const customer = source.customerId?.trim();
  if (customer) return customer;
  return source.sessionId;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function contributorId(source: ContributorSource): Promise<string> {
  return sha256Hex(contributorSource(source));
}

/**
 * The key apply_contribution's $50 daily window counts by: "card:" and a hash
 * of the card's Stripe fingerprint, or "email:" and the contributor id when
 * the payment carries no card (Link, for one). The window also counts every
 * payment with the same contributor id, so a second card on one email shares
 * the $50 too.
 */
export async function payerKey(
  cardFingerprint: string | null | undefined,
  contributor: string,
): Promise<string> {
  const fingerprint = cardFingerprint?.trim();
  if (fingerprint) return `card:${await sha256Hex(fingerprint)}`;
  return `email:${contributor}`;
}

/** A goal card id is accepted only when it is a well-formed uuid; the RPC checks the card itself. */
export function goalCardId(
  clientReferenceId: string | null | undefined,
  metadataGoalCardId: string | null | undefined,
): string | null {
  for (const candidate of [clientReferenceId, metadataGoalCardId]) {
    if (candidate && UUID_PATTERN.test(candidate)) {
      return candidate.toLowerCase();
    }
  }
  return null;
}
