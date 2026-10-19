// Whether the agents are offline (docs/specs/honest-status.md): the supply's offline flag. It lives
// apart from source.ts so a component reads it without loading the snapshot reader and its JSON key
// list, which Playwright's loader cannot import from the e2e specs that import a page.
import type { Snapshot } from './source';

/** Whether the agents are offline (Supply.offline); a snapshot without a supply reads as not offline. */
export function agentsOffline(snapshot: Pick<Snapshot, 'supply'>): boolean {
  return snapshot.supply?.offline === true;
}
