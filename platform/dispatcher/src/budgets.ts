// The dollar budget of every card pipeline this process runs, and what its sessions have spent so far
// by their running meters. The tick sets a card's budget when it claims the card; every session of
// that claim (the build and any visual revision, docs/specs/design-review.md) spends from the same
// budget, so the spend recorded is the sum across them, and a revision starts with only what the
// earlier sessions left. While the card is building, or gated with a revision still possible, what is
// left is held from every other card, from the daily, monthly and tier caps and from the Console
// credit (throttle.ts). The pipeline closes the budget once no further session can run for the card,
// and the entry goes when the card's pipeline ends.
import { round4 } from './pricing.js';

interface Entry {
  budgetUsd: number;
  // Every session's spend this claim: the earlier sessions' and the running one's.
  spentUsd: number;
  // What the earlier sessions had spent when the running one started.
  baseUsd: number;
}

export class SessionBudgets {
  private readonly entries = new Map<string, Entry>();

  // An attended session is billed to the founder, so its budget is unbounded (Infinity).
  start(cardId: string, budgetUsd: number): void {
    this.entries.set(cardId, { budgetUsd, spentUsd: 0, baseUsd: 0 });
  }

  budgetFor(cardId: string): number | undefined {
    return this.entries.get(cardId)?.budgetUsd;
  }

  // A new session of the card starts: its meter counts from zero on top of what the earlier sessions
  // spent. Returns what the session may spend, the budget less that spend (never below zero), or
  // undefined for a card the tick did not claim.
  nextSession(cardId: string): number | undefined {
    const entry = this.entries.get(cardId);
    if (!entry) return undefined;
    entry.baseUsd = entry.spentUsd;
    return Math.max(0, round4(entry.budgetUsd - entry.spentUsd));
  }

  // The running session's estimate of its own spend; the card's recorded spend only ever rises.
  record(cardId: string, sessionUsd: number): void {
    const entry = this.entries.get(cardId);
    if (entry) entry.spentUsd = Math.max(entry.spentUsd, round4(entry.baseUsd + sessionUsd));
  }

  // No further session will run for the card: what is left of its budget is no longer held.
  close(cardId: string): void {
    const entry = this.entries.get(cardId);
    if (entry) entry.budgetUsd = entry.spentUsd;
  }

  finish(cardId: string): void {
    this.entries.delete(cardId);
  }

  // What each card's sessions may still spend: its budget less their spend, never below zero.
  remaining(): Map<string, number> {
    const left = new Map<string, number>();
    for (const [cardId, entry] of this.entries) left.set(cardId, Math.max(0, round4(entry.budgetUsd - entry.spentUsd)));
    return left;
  }
}
