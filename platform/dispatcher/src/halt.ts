// The process-level halt. A card whose session changed the repository's git configuration sets it,
// and from then on the tick claims no card. It lives in memory only: a restart clears it, after the
// operator has looked at the repository. It never writes studio_state.paused, which is the board's.
export interface Halt {
  reason: string | null;
}

export function createHalt(): Halt {
  return { reason: null };
}
