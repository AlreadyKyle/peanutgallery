import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RUNNING_MODEL, runningModelsCheck } from '../scripts/team-models.mjs';

const line = (model: string) => `${model} · Hired 13 Sep 2026 · 2 cards shipped · Changes the game`;

describe('the /team model check live-check.mjs runs on production', () => {
  it('names the model the board set for every role that runs', () => {
    expect(RUNNING_MODEL).toBe('claude-opus-5-5');
  });

  it('passes when every running role shows that model', () => {
    const result = runningModelsCheck([line('claude-opus-5-5'), line('claude-opus-5-5'), line('claude-opus-5-5')]);
    expect(result).toEqual({ ok: true, message: '/team 3 running roles, each on claude-opus-5-5: claude-opus-5-5, claude-opus-5-5, claude-opus-5-5' });
  });

  it('fails when no role runs, since the Running section is then missing', () => {
    expect(runningModelsCheck([])).toEqual({ ok: false, message: '/team 0 running roles, each on claude-opus-5-5: none' });
  });

  it('fails a stale re-seed that left a running role on another claude model', () => {
    const result = runningModelsCheck([line('claude-opus-5-5'), line('claude-sonnet-5'), line('claude-opus-5-5')]);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('claude-sonnet-5');
  });

  it('fails a running role that shows no model, or a longer id that starts the same way', () => {
    expect(runningModelsCheck([' · Hired 13 Sep 2026 · No cards shipped yet']).ok).toBe(false);
    expect(runningModelsCheck([line('claude-opus-5-5-preview')]).ok).toBe(false);
  });

  it('is what live-check.mjs runs on the Running section', () => {
    const script = readFileSync(resolve(process.cwd(), 'scripts/live-check.mjs'), 'utf8');
    expect(script).toContain("import { runningModelsCheck } from './team-models.mjs';");
    expect(script).toMatch(/runningModelsCheck\(await running\.locator\('li\.agent \.card-meta'\)\.allTextContents\(\)\)/);
  });
});
