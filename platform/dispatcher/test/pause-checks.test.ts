// pause-checks.ts against the migration and the source (docs/specs/unattended-roles.md, PR3): its lists
// are the migration's auto_resume_checks rows, and every failing check the dispatcher pauses a card with
// is in one list or the other, so no new stop waits on the board unnoticed.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLI_VERSION_CHECK } from '../src/cli-pin.js';
import { REFUSAL_CHECK } from '../src/credit.js';
import { AUTO_RESUME_CHECKS, AUTO_RESUME_LIMITS, MANUAL_CHECKS, autoResumeKind, resumeWords } from '../src/pause-checks.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const MIGRATION = path.resolve(ROOT, '..', 'supabase', 'migrations', '20261010000000_auto_resume.sql');
const SRC = path.join(ROOT, 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

// The migration's seed rows: ('check', 'kind') pairs inside the auto_resume_checks insert.
function seededChecks(): Record<string, string[]> {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf('insert into public.auto_resume_checks');
  const end = sql.indexOf('on conflict', start);
  expect(start).toBeGreaterThan(0);
  const seeded: Record<string, string[]> = { free: [], infra: [], session: [] };
  for (const match of sql.slice(start, end).matchAll(/\('([a-z_]+)', '([a-z]+)'\)/g)) seeded[match[2]!]!.push(match[1]!);
  return seeded;
}

// The string literals in a call's first argument, and the constants it names resolved.
function checksIn(expression: string): string[] {
  const found = [...expression.matchAll(/'([a-z_:]+)'/g)].map((match) => match[1]!);
  if (expression.includes('REFUSAL_CHECK')) found.push(...Object.values(REFUSAL_CHECK));
  if (expression.includes('CLI_VERSION_CHECK')) found.push(CLI_VERSION_CHECK);
  return found;
}

// A first argument that passes on a check another site already chose: classifyFailure re-raising an
// InfraStop, waitForGatePass raising gateInfrastructure's check, and runSession raising a session
// outcome's PAUSING_OUTCOMES check (both read below).
const PASSED_ON = new Set(['error.failingCheck', 'infra.check', 'pausing']);

// Every failing check the dispatcher's source can pause a card with.
function pausingChecks(): Map<string, string> {
  const checks = new Map<string, string>();
  const add = (check: string, where: string) => checks.set(check, where);
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    const name = path.relative(ROOT, file);
    const calls: [RegExp, string][] = [
      [/new CardStop\(\s*'paused',\s*([^,]+),/g, 'CardStop'],
      [/new InfraStop\(\s*([^,]+),/g, 'InfraStop'],
      [/new SessionPaused\(\s*([^,]+),/g, 'SessionPaused'],
    ];
    for (const [pattern, kind] of calls) {
      for (const match of text.matchAll(pattern)) {
        const expression = match[1]!.trim();
        if (PASSED_ON.has(expression)) continue;
        const found = checksIn(expression);
        expect(found, `${name}: ${kind}(${expression}) names no check this test can read`).not.toEqual([]);
        for (const check of found) add(check, `${name} ${kind}`);
      }
    }
    // gateInfrastructure's checks, which waitForGatePass raises as InfraStop(infra.check, ...).
    if (text.includes('async function gateInfrastructure')) {
      const body = text.slice(text.indexOf('async function gateInfrastructure'));
      for (const match of body.slice(0, body.indexOf('\n}\n')).matchAll(/check: '([a-z_]+)'/g)) add(match[1]!, `${name} gateInfrastructure`);
    }
    // The session outcomes that pause a card, and recovery's pauses (its default included).
    if (text.includes('const PAUSING_OUTCOMES')) {
      const body = text.slice(text.indexOf('const PAUSING_OUTCOMES'));
      for (const match of body.slice(0, body.indexOf('};')).matchAll(/:\s*'([a-z_]+)'/g)) add(match[1]!, `${name} PAUSING_OUTCOMES`);
    }
    for (const match of text.matchAll(/await pause\(deps, card(?:, '([a-z_]+)')?/g)) add(match[1] ?? 'dispatcher_restart', `${name} pause`);
    for (const match of text.matchAll(/check = '([a-z_]+)'/g)) add(match[1]!, `${name} default`);
  }
  return checks;
}

describe('pause-checks', () => {
  it("lists exactly the migration's seed rows, kind by kind", () => {
    const seeded = seededChecks();
    for (const kind of ['free', 'infra', 'session'] as const) {
      expect([...AUTO_RESUME_CHECKS[kind]].sort(), kind).toEqual([...seeded[kind]!].sort());
    }
  });

  it('keeps the manual checks out of every list, and a check in one kind only', () => {
    const all = [...AUTO_RESUME_CHECKS.free, ...AUTO_RESUME_CHECKS.infra, ...AUTO_RESUME_CHECKS.session];
    expect(new Set(all).size).toBe(all.length);
    for (const check of MANUAL_CHECKS) expect(autoResumeKind(check), check).toBeNull();
    expect(autoResumeKind('ceiling')).toBeNull();
    expect(autoResumeKind('something_new')).toBeNull();
    expect([autoResumeKind('dispatcher_restart'), autoResumeKind('gate_missing'), autoResumeKind('wall_clock')]).toEqual(['free', 'infra', 'session']);
  });

  it('classifies every failing check the source pauses a card with as auto-resumed or manual', () => {
    const checks = pausingChecks();
    // The scan finds the stops it is meant to: one of each source.
    for (const check of ['dispatcher_restart', 'session_unsettled', 'console_credit', 'usage_tier_cap', 'cli_version', 'gate_missing', 'main_red', 'outage', 'ceiling', 'horizon', 'vetoed', 'read_token', 'unknown_model', 'budget', 'patch_conflict', 'adapter']) {
      expect(checks.has(check), `the scan finds ${check}`).toBe(true);
    }
    const unclassified = [...checks].filter(([check]) => autoResumeKind(check) === null && !MANUAL_CHECKS.includes(check));
    expect(unclassified).toEqual([]);
  });

  it("states the migration's bounds", () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const body = sql.slice(sql.indexOf('create or replace function public.auto_resume_due'));
    expect(body).toContain(`when v_ever >= ${AUTO_RESUME_LIMITS.ever} then 'limit_ever'`);
    expect(body).toContain(`when v_kind = 'session' and v_session_ever >= ${AUTO_RESUME_LIMITS.sessionEver} then 'limit_session'`);
    expect(body).toContain(`when v_day >= ${AUTO_RESUME_LIMITS.perDay} then 'limit_day'`);
    expect(body).toContain(`make_interval(mins => (${AUTO_RESUME_LIMITS.backoffMinutes} * power(2, v_day))::integer)`);
  });

  it('words an alert by kind: bounded for auto-resumed checks, /board for manual ones', () => {
    expect(resumeWords('dispatcher_restart')).toBe('It resumes on its own once nothing blocks it (at most 3 times a day and 8 in all, backing off from 15 minutes), or from /board sooner.');
    expect(resumeWords('wall_clock')).toContain('at most 3 times a day and 2 in all');
    expect(resumeWords('ceiling')).toBe('Resume it from /board once the cause is fixed.');
  });
});
