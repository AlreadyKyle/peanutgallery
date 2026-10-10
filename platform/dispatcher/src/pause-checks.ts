// Which paused cards resume on their own (docs/specs/unattended-roles.md, PR3). A card paused for a
// reason that is not its own change goes back to funded with no one acting, through the database's
// auto_resume_due (20261010000000_auto_resume.sql), which the tick calls after resume by rule. These
// lists are the migration's auto_resume_checks rows; test/pause-checks.test.ts reads the migration and
// checks every failing check the dispatcher pauses a card with is in one list or the other.
//
// free     the dispatcher stopped or restarted, the studio or the board session paused it, the
//          Console credit or the usage tier refused the key, or Claude Code was off its pin.
// infra    an outage, or a dispatcher, GitHub, Managed Agents or gate fault.
// session  the session stopped at a bound below the card's ceiling; a resume starts a new session.
//
// Manual checks wait for the board: the ceiling (resume by rule resumes it once), the board's horizon
// move, a veto, a read token that can write, a model the price table does not list, and any check
// not listed here.
export type AutoResumeKind = 'free' | 'infra' | 'session';

export const AUTO_RESUME_CHECKS: Readonly<Record<AutoResumeKind, readonly string[]>> = {
  free: ['dispatcher_restart', 'dispatcher_stopped', 'session_unsettled', 'paused_by_board', 'console_credit', 'usage_tier_cap', 'board_session', 'board_review', 'cli_version'],
  infra: [
    'outage',
    'frames',
    'dispatcher_error',
    'pr_head',
    'stream_lost',
    'ledger',
    'managed_api',
    'system_prompt',
    'repo_skills',
    'card_spend',
    'deploy_timeout',
    'post_merge_outage',
    'adapter',
    'gate_missing',
    'gate_pending',
    'gate_infrastructure',
    'main_red',
  ],
  session: ['budget', 'wall_clock', 'turn_cap', 'visual_review', 'patch_conflict'],
};

export const MANUAL_CHECKS: readonly string[] = ['ceiling', 'horizon', 'vetoed', 'read_token', 'unknown_model'];

// auto_resume_due's bounds, per card: in the last 24 hours, in all, and in all of kind session; and the
// backoff, BACKOFF_MINUTES times 2 to the power of the last 24 hours' count since the newest.
export const AUTO_RESUME_LIMITS = { perDay: 3, ever: 8, sessionEver: 2, backoffMinutes: 15 } as const;

export function autoResumeKind(check: string): AutoResumeKind | null {
  for (const kind of ['free', 'infra', 'session'] as const) {
    if (AUTO_RESUME_CHECKS[kind].includes(check)) return kind;
  }
  return null;
}

// What an alert says about a card paused with this check: that it resumes on its own, and within what
// bounds, or that the board resumes it.
export function resumeWords(check: string): string {
  const kind = autoResumeKind(check);
  if (kind === null) return 'Resume it from /board once the cause is fixed.';
  const all = kind === 'session' ? AUTO_RESUME_LIMITS.sessionEver : AUTO_RESUME_LIMITS.ever;
  return `It resumes on its own once nothing blocks it (at most ${AUTO_RESUME_LIMITS.perDay} times a day and ${all} in all, backing off from ${AUTO_RESUME_LIMITS.backoffMinutes} minutes), or from /board sooner.`;
}
