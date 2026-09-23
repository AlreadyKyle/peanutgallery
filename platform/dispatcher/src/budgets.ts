// The dollar budget of every session this process runs, and what each has spent so far by the
// session's running meter. The tick sets a card's budget when it claims the card, the session reports
// its spend as it meters, and the entry goes when the card's pipeline ends. While the card is building,
// what is left of its budget is held from every other card, from the daily cap and from the Console
// credit (throttle.ts).
import { round4 } from './pricing.js';

interface Entry {
  budgetUsd: number;
  spentUsd: number;
}

export class SessionBudgets {
  private readonly entries = new Map<string, Entry>();

  // An attended session is billed to the founder, so its budget is unbounded (Infinity).
  start(cardId: string, budgetUsd: number): void {
    this.entries.set(cardId, { budgetUsd, spentUsd: 0 });
  }

  budgetFor(cardId: string): number | undefined {
    return this.entries.get(cardId)?.budgetUsd;
  }

  // The session's running estimate of its own spend; it only ever rises.
  record(cardId: string, spentUsd: number): void {
    const entry = this.entries.get(cardId);
    if (entry) entry.spentUsd = Math.max(entry.spentUsd, spentUsd);
  }

  finish(cardId: string): void {
    this.entries.delete(cardId);
  }

  // What each session may still spend: its budget less its spend, never below zero.
  remaining(): Map<string, number> {
    const left = new Map<string, number>();
    for (const [cardId, entry] of this.entries) left.set(cardId, Math.max(0, round4(entry.budgetUsd - entry.spentUsd)));
    return left;
  }
}
