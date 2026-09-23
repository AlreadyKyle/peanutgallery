// The ledger identity (docs/specs/refunds-and-holds.md). Every pool figure is a
// plain sum over contribution rows and studio-billed ledger rows:
//   I1  pool.reserve_usd                                        = sum(contributions.reserve_usd)
//   I2  pool.balance_usd + pool.incident_reserve_usd + held_usd = sum(contributions.agents_usd) - sum(studio ledger.usd)
//   I3  pool.held_usd                                           = sum(contributions.held_usd)
// and every allocation the waterfall wrote (docs/specs/money-logic.md), each line
// a count of what drifts:
//   I4  payments whose allocations differ from their family's credit
//       (agents less incident less held, over the payment and its child rows)
//   I5  cards whose funded_usd differs from their allocations
// Amounts are numeric(12,4) strings; they are summed as integer ten-thousandths
// so no float rounding can hide or invent a drift.
//
// Only studio rows touch the pool. Founder rows (attended work on the founder's
// subscription) and overhead rows (the studio's own startup checks, paid from
// the studio share) are recorded without moving it, so the identity leaves them
// out; a row with no billed_to is a studio row, as the column defaults.

export interface PoolRow {
  balance_usd: string | number;
  reserve_usd: string | number;
  incident_reserve_usd: string | number;
  held_usd: string | number;
}

export interface ContributionSums {
  reserve_usd: string | number;
  agents_usd: string | number;
  held_usd: string | number;
}

/** A contribution row as I4 reads it: its family and its credit. */
export interface ContributionCredit {
  id: string;
  parent_id: string | null;
  agents_usd: string | number;
  incident_usd: string | number;
  held_usd: string | number;
}

export interface AllocationRow {
  payment_id: string;
  destination: "card" | "unassigned" | "board_test";
  card_id: string | null;
  amount_usd: string | number;
}

export interface CardBar {
  id: string;
  funded_usd: string | number;
}

export type LedgerBilling = "studio" | "founder" | "overhead";

export interface LedgerRow {
  usd: string | number;
  billed_to?: LedgerBilling;
}

/** Whether a ledger row was taken from the pool: studio rows only. */
export function debitsPool(row: LedgerRow): boolean {
  return (row.billed_to ?? "studio") === "studio";
}

/** The studio and overhead totals of a set of ledger rows, as four-decimal strings. */
export function ledgerTotals(ledger: LedgerRow[]): { studio: string; overhead: string } {
  const sum = (rows: LedgerRow[]) => rows.reduce<bigint>((total, r) => total + toUnits(r.usd), 0n);
  return {
    studio: fromUnits(sum(ledger.filter(debitsPool))),
    overhead: fromUnits(sum(ledger.filter((r) => r.billed_to === "overhead"))),
  };
}

export interface IdentityLine {
  name: "I1" | "I2" | "I3" | "I4" | "I5";
  left: string;
  right: string;
  drift: string;
  holds: boolean;
}

/** "12.3456" or 12.3456 as 123456; throws on anything that is not a finite amount with at most 4 decimals. */
export function toUnits(value: string | number): bigint {
  const text = typeof value === "number" ? value.toFixed(4) : value.trim();
  const match = /^(-)?(\d+)(?:\.(\d{1,4}))?$/.exec(text);
  if (!match) throw new Error(`not an amount: ${String(value)}`);
  const units = BigInt(match[2]!) * 10000n + BigInt((match[3] ?? "").padEnd(4, "0"));
  return match[1] ? -units : units;
}

export function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / 10000n;
  const frac = (abs % 10000n).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

function line(name: IdentityLine["name"], left: bigint, right: bigint): IdentityLine {
  return { name, left: fromUnits(left), right: fromUnits(right), drift: fromUnits(left - right), holds: left === right };
}

export function checkIdentity(pool: PoolRow, contributions: ContributionSums[], ledger: LedgerRow[]): IdentityLine[] {
  const sum = (values: (string | number)[]) => values.reduce<bigint>((total, v) => total + toUnits(v), 0n);
  const reserve = sum(contributions.map((c) => c.reserve_usd));
  const agents = sum(contributions.map((c) => c.agents_usd));
  const held = sum(contributions.map((c) => c.held_usd));
  const spent = sum(ledger.filter(debitsPool).map((l) => l.usd));
  return [
    line("I1", toUnits(pool.reserve_usd), reserve),
    line("I2", toUnits(pool.balance_usd) + toUnits(pool.incident_reserve_usd) + toUnits(pool.held_usd), agents - spent),
    line("I3", toUnits(pool.held_usd), held),
  ];
}

/**
 * I4 and I5 as counts: left is how many payments (I4) or cards (I5) drift, right
 * is 0. A payment with no allocation and no credit, and a card with no allocation
 * and an empty bar, hold.
 */
export function checkAllocations(contributions: ContributionCredit[], allocations: AllocationRow[], cards: CardBar[]): IdentityLine[] {
  const credit = new Map<string, bigint>();
  for (const c of contributions) {
    const family = c.parent_id ?? c.id;
    credit.set(family, (credit.get(family) ?? 0n) + toUnits(c.agents_usd) - toUnits(c.incident_usd) - toUnits(c.held_usd));
  }
  const placed = new Map<string, bigint>();
  const bars = new Map<string, bigint>();
  for (const a of allocations) {
    placed.set(a.payment_id, (placed.get(a.payment_id) ?? 0n) + toUnits(a.amount_usd));
    if (a.destination === "card" && a.card_id) bars.set(a.card_id, (bars.get(a.card_id) ?? 0n) + toUnits(a.amount_usd));
  }
  let payments = 0n;
  for (const id of new Set([...credit.keys(), ...placed.keys()])) {
    if ((credit.get(id) ?? 0n) !== (placed.get(id) ?? 0n)) payments += 1n;
  }
  let drifting = 0n;
  for (const card of cards) {
    if (toUnits(card.funded_usd) !== (bars.get(card.id) ?? 0n)) drifting += 1n;
  }
  const count = (name: "I4" | "I5", n: bigint): IdentityLine => ({ name, left: String(n), right: "0", drift: String(n), holds: n === 0n });
  return [count("I4", payments), count("I5", drifting)];
}
