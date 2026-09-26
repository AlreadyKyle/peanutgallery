// The /team model fact live-check.mjs asserts against production, kept apart so the site's unit
// tests can run it on made-up rosters (src/team-models.test.ts).

/** The model every role that runs is on (docs/PLAN.md §10 decision 36). */
export const RUNNING_MODEL = 'claude-opus-5-5';

/**
 * Checks the facts lines of the roles in /team's Running section, in page order: the li.agent rows
 * whose roster status is running, drawn running or paused (lib/roster.ts teamStatus), except a
 * code-only role's (li.agent[data-kind="code"]), which calls no model and says so. A line starts
 * with the role's model, then " · " (Team.tsx roleFacts). Every line must name RUNNING_MODEL,
 * and there must be at least one: the seed-1 builders and QA run from launch, so an empty list
 * means the section is missing, not that every model is right. A stale re-seed that left a
 * running role on another model fails, naming what it found.
 *
 * @param {readonly string[]} facts
 * @returns {{ ok: boolean, message: string }}
 */
export function runningModelsCheck(facts) {
  const models = facts.map((line) => (line.split(' · ')[0] ?? '').trim());
  const ok = models.length > 0 && models.every((model) => model === RUNNING_MODEL);
  const found = models.length === 0 ? 'none' : models.map((model) => model || '(no model)').join(', ');
  return { ok, message: `/team ${models.length} running roles, each on ${RUNNING_MODEL}: ${found}` };
}
