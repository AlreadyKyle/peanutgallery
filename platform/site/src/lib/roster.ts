import { pausedSentence } from '../components/PausedNotice';
import { copy } from './copy';
import type { Role, Snapshot } from './source';

/**
 * The roles that build cards, and the folder each builds in. teamStatus reads it: a card role whose
 * folder is closed starts when the board opens the lane, whatever the roster says. The Studio Head, the Game Designer and
 * the Game Director run the board's Rank now and Draft a game card and build no card; the rest of the
 * roster has no job that runs yet: note triage, the report, the stream and outside research are
 * backlog cards. The board's own site keeps the same list for its executor choice
 * (platform/board/src/lib/board.ts).
 */
export const CARD_ROLE_FOLDERS: Readonly<Record<string, string>> = {
  'Builder A': 'seed-1',
  'Builder B': 'seed-1',
  QA: 'seed-1',
  'Platform Builder': 'platform',
};

/**
 * The folders whose cards run. The platform code lane (platform/site outside the kernel paths) opens
 * once the board has its own site and studio_state.platform_lane_open is set (docs/specs/board-site.md);
 * until then the dispatcher refuses those cards, and set_card_horizon, file_card and resume_card
 * refuse them on now.
 */
export function openFolders(platformLaneOpen: boolean): readonly string[] {
  return platformLaneOpen ? ['seed-1', 'platform'] : ['seed-1'];
}

/** An active role that builds cards, whether or not its folder is open. */
export function isCardRole(role: Role): boolean {
  return role.state === 'active' && role.write_access && Object.hasOwn(CARD_ROLE_FOLDERS, role.title);
}

/** The folder a card role changes, or null for a role that builds no cards. */
export function cardRoleFolder(role: Role): string | null {
  return isCardRole(role) ? (CARD_ROLE_FOLDERS[role.title] ?? null) : null;
}

/**
 * Where a role stands on /team and home's team strip (docs/specs/supporter-pages.md), with the one
 * sentence that says why when it is not simply running:
 * - running: roster status running, not paused, and (for a card role) its folder is open;
 * - paused: roster status running while the studio is paused (its reason's words, else the paused
 *   notice) or while the role itself is paused (its own reason, else a plain line);
 * - starts: roster status starts, with its trigger; or a card role whose folder the board has not
 *   opened, which starts when the board opens the studio code lane;
 * - planned: roster status planned or unset, with its trigger when it has one.
 */
export type TeamKind = 'running' | 'paused' | 'starts' | 'planned';
/** by: who paused a paused role, the studio (one sentence for every row) or the role itself. */
export type TeamStatus = { kind: TeamKind; sentence: string | null; by?: 'studio' | 'role' };

export function teamStatus(role: Role, snapshot: Snapshot): TeamStatus {
  if (role.status === 'running') {
    const folder = cardRoleFolder(role);
    if (folder !== null && !openFolders(snapshot.platformLaneOpen === true).includes(folder)) {
      return { kind: 'starts', sentence: copy.team.laneClosed };
    }
    if (role.paused === true) return { kind: 'paused', sentence: role.paused_reason ?? copy.team.rolePaused, by: 'role' };
    const studioPaused = pausedSentence(snapshot);
    if (studioPaused !== null) return { kind: 'paused', sentence: studioPaused, by: 'studio' };
    return { kind: 'running', sentence: null };
  }
  if (role.status === 'starts') return { kind: 'starts', sentence: role.trigger ?? null };
  return { kind: 'planned', sentence: role.trigger ?? null };
}

/** A role that is running or paused: its model, cost and ships show, and it sits in Running. */
export function onTheTeam(status: TeamStatus): boolean {
  return status.kind === 'running' || status.kind === 'paused';
}

/** Home's team strip: the first three active roles on the team (running or paused), in roster order. */
export function teamStrip(snapshot: Snapshot, count = 3): Role[] {
  return snapshot.roles.filter((role) => role.state === 'active' && onTheTeam(teamStatus(role, snapshot))).slice(0, count);
}
