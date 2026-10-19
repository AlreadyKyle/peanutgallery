import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DESIGNER_MODEL, DESIGNER_ROLE, RUNNING_MODEL, runningModelsCheck, runningRoleRows } from '../scripts/team-models.mjs';

const row = (model: string, name = 'Builder A') => ({ name, facts: `${model} · Hired 13 Sep 2026 · 2 cards shipped · Changes the game` });
const MESSAGE = '/team 3 running roles on claude-opus-5-5, the Game Designer on claude-sonnet-5-5';

describe('the /team model check live-check.mjs runs on production', () => {
  it('names the model the board set for every role that runs, and the Game Designer’s (PLAN.md §10 decision 77)', () => {
    expect(RUNNING_MODEL).toBe('claude-opus-5-5');
    expect(DESIGNER_ROLE).toBe('Game Designer');
    expect(DESIGNER_MODEL).toBe('claude-sonnet-5-5');
  });

  it('passes when every running role shows that model', () => {
    const result = runningModelsCheck([row('claude-opus-5-5'), row('claude-opus-5-5'), row('claude-opus-5-5')]);
    expect(result).toEqual({ ok: true, message: `${MESSAGE}: claude-opus-5-5, claude-opus-5-5, claude-opus-5-5` });
  });

  it('passes the Game Designer on its own model, or on the others’', () => {
    const designer = [row('claude-opus-5-5'), row('claude-sonnet-5-5', 'Game Designer'), row('claude-opus-5-5', 'Game Director')];
    expect(runningModelsCheck(designer)).toEqual({ ok: true, message: `${MESSAGE}: claude-opus-5-5, claude-sonnet-5-5, claude-opus-5-5` });
    expect(runningModelsCheck([row('claude-opus-5-5', ' Game Designer ')]).ok).toBe(true);
  });

  it('fails any other running role on the Game Designer’s model', () => {
    for (const name of ['Builder A', 'Game Director', 'Platform Director', 'QA', 'Studio Head', 'Game designer']) {
      const result = runningModelsCheck([row('claude-sonnet-5-5', 'Game Designer'), row('claude-sonnet-5-5', name)]);
      expect(result.ok, name).toBe(false);
    }
  });

  it('fails when no role runs, since the Running section is then missing', () => {
    expect(runningModelsCheck([])).toEqual({ ok: false, message: '/team 0 running roles on claude-opus-5-5, the Game Designer on claude-sonnet-5-5: none' });
  });

  it('fails a stale re-seed that left a running role on another claude model', () => {
    const result = runningModelsCheck([row('claude-opus-5-5'), row('claude-sonnet-5'), row('claude-opus-5-5')]);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('claude-sonnet-5');
    expect(runningModelsCheck([row('claude-sonnet-5', 'Game Designer')]).ok).toBe(false);
  });

  it('fails a running role that shows no model, or a longer id that starts the same way', () => {
    expect(runningModelsCheck([{ name: 'QA', facts: ' · Hired 13 Sep 2026 · No cards shipped yet' }]).ok).toBe(false);
    expect(runningModelsCheck([row('claude-opus-5-5-preview')]).ok).toBe(false);
    expect(runningModelsCheck([row('claude-sonnet-5-5-preview', 'Game Designer')]).ok).toBe(false);
  });

  it('reads each running row that calls a model: its name and its facts line', async () => {
    const text = (textContent: string) => ({ textContent });
    const rows = [
      { querySelector: (selector: string) => text(selector === 'h3' ? 'Game Designer' : 'claude-sonnet-5-5 · Worked on 1 shipped card') },
      { querySelector: (selector: string) => (selector === 'h3' ? text('QA') : null) },
    ];
    const selectors: string[] = [];
    const running = {
      locator: (selector: string) => {
        selectors.push(selector);
        return { evaluateAll: async (read: (elements: typeof rows) => unknown) => read(rows) };
      },
    };
    expect(await runningRoleRows(running as never)).toEqual([
      { name: 'Game Designer', facts: 'claude-sonnet-5-5 · Worked on 1 shipped card' },
      { name: 'QA', facts: '' },
    ]);
    expect(selectors).toEqual(['li.agent:not([data-kind="code"])']);
  });

  it('is what live-check.mjs runs on the Running section', () => {
    const script = readFileSync(resolve(process.cwd(), 'scripts/live-check.mjs'), 'utf8');
    expect(script).toContain("import { runningModelsCheck, runningRoleRows } from './team-models.mjs';");
    expect(script).toContain('runningModelsCheck(await runningRoleRows(running))');
  });
});
