// The /team model fact live-check.mjs asserts against production, kept apart so the site's unit
// tests can run it on made-up rosters (src/team-models.test.ts).

/** The model every role that runs is on (docs/PLAN.md §10 decision 36), but the Game Designer. */
export const RUNNING_MODEL = 'claude-opus-5-5';

/** The one role that may run on another model, and that model (docs/PLAN.md §10 decision 77). */
export const DESIGNER_ROLE = 'Game Designer';
export const DESIGNER_MODEL = 'claude-sonnet-5-5';

/**
 * Checks the roles in /team's Running section, in page order: the li.agent rows whose roster status
 * is running, drawn running or paused (lib/roster.ts teamStatus), except a code-only role's
 * (li.agent[data-kind="code"]), which calls no model and says so. A row is the role's name (its h3)
 * and its facts line, which starts with the role's model, then " · " (Team.tsx roleFacts). Every
 * line must name RUNNING_MODEL, or DESIGNER_MODEL on the row named DESIGNER_ROLE, and there must be
 * at least one: the seed-1 builders and QA run from launch, so an empty list means the section is
 * missing, not that every model is right. A stale re-seed that left a running role on another
 * model fails, naming what it found.
 *
 * @param {readonly { name: string, facts: string }[]} rows
 * @returns {{ ok: boolean, message: string }}
 */
export function runningModelsCheck(rows) {
  const models = rows.map(({ name, facts }) => ({ name: name.trim(), model: (facts.split(' · ')[0] ?? '').trim() }));
  const allowed = ({ name, model }) => model === RUNNING_MODEL || (name === DESIGNER_ROLE && model === DESIGNER_MODEL);
  const ok = models.length > 0 && models.every(allowed);
  const found = models.length === 0 ? 'none' : models.map(({ model }) => model || '(no model)').join(', ');
  return { ok, message: `/team ${models.length} running roles on ${RUNNING_MODEL}, the ${DESIGNER_ROLE} on ${DESIGNER_MODEL}: ${found}` };
}

/**
 * The rows runningModelsCheck reads, from the Running section's locator.
 *
 * @param {import('@playwright/test').Locator} running
 * @returns {Promise<{ name: string, facts: string }[]>}
 */
export function runningRoleRows(running) {
  return running
    .locator('li.agent:not([data-kind="code"])')
    .evaluateAll((rows) => rows.map((row) => ({ name: row.querySelector('h3')?.textContent ?? '', facts: row.querySelector('.card-meta')?.textContent ?? '' })));
}
