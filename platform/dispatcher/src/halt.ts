// The process-level halt. A card whose session or smoke bot changed what git reads as configuration
// sets it. From then on the tick claims no card and worktree.ts runs no git at all, so nothing the
// agent code planted can run with the dispatcher's environment. It lives in memory only and clears
// when the process restarts, and startup refuses a repository whose git configuration is still not
// allowed (startup.ts). It never writes studio_state.paused, which is the board's.
let reason: string | null = null;

export class HaltedError extends Error {
  constructor(why: string) {
    super(`the dispatcher is halted (${why}); no git runs until it restarts`);
    this.name = 'HaltedError';
  }
}

// The first reason stays.
export function haltDispatcher(why: string): void {
  reason ??= why;
}

export function haltReason(): string | null {
  return reason;
}

// Tests only: a real process clears the halt by restarting.
export function resetHalt(): void {
  reason = null;
}
