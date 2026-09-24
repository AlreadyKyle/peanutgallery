import type { Role } from './source';

/**
 * The roles that build cards, and the folder each builds in. The Studio Head, the Game Designer and
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

/** A card role whose folder is open: the only roles /team shows as running. */
export function runsCards(role: Role, platformLaneOpen = false): boolean {
  const folder = cardRoleFolder(role);
  return folder !== null && openFolders(platformLaneOpen).includes(folder);
}
