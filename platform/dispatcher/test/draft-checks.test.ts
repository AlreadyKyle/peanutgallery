// The checks on a Game Designer's draft (src/draft-checks.ts, docs/specs/agent-workflows.md): each
// one refuses by name with every other check passing.
import { describe, expect, it } from 'vitest';
import type { Role } from '../src/db.js';
import { checkDraft, draftTotalUsd, seedExecutor, type CardDraft, type DraftCheckDeps } from '../src/draft-checks.js';
import { role } from './helpers/fake-db.js';

const SPAWN = JSON.stringify({ rows: [{ id: 'gatherer', baseCost: 10 }] });
const ROLES: Role[] = [
  role(),
  role({ id: 'role-builder-b', name: 'Builder B', title: 'Builder B' }),
  role({ id: 'role-qa', name: 'QA', title: 'QA' }),
  role({ id: 'role-tech-artist', name: 'Tech Artist', title: 'Tech Artist', tools_json: [], write_access: false }),
  role({ id: 'role-designer', name: 'Game Designer', title: 'Game Designer', agent_class: 'planner', tools_json: ['Read', 'Glob', 'Grep', 'Bash'] }),
];

function draft(overrides: Partial<CardDraft> = {}): CardDraft {
  return {
    title: 'Gatherers cost 11',
    summary: 'The gatherer costs one more to build.',
    intent: 'Raise the gatherer base cost by one.',
    acceptance_test: 'The gatherer costs 11.\ncheck: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 11',
    lane: 'config',
    executor: 'Builder A',
    estimate_usd: 0.5,
    ...overrides,
  };
}

function deps(overrides: Partial<DraftCheckDeps> = {}): DraftCheckDeps & { reads: string[]; scanned: string[][] } {
  const reads: string[] = [];
  const scanned: string[][] = [];
  return {
    readMain: async (file) => {
      reads.push(file);
      return file === 'seed-1/config/spawn-table.json' ? SPAWN : null;
    },
    scanText: async (strings) => {
      scanned.push([...strings]);
      return { ok: true };
    },
    cardMaxUsd: 5,
    roles: ROLES,
    reads,
    scanned,
    ...overrides,
  };
}

describe('checkDraft', () => {
  it('passes a draft that meets every check, scanning every text field once', async () => {
    const d = deps();
    expect(await checkDraft(draft(), d)).toEqual({ ok: true });
    expect(d.scanned).toEqual([[draft().title, draft().summary, draft().intent, draft().acceptance_test]]);
  });

  it('refuses a draft that is not ready: no text, no check: line', async () => {
    expect(await checkDraft(draft({ title: '  ' }), deps())).toMatchObject({ ok: false, check: 'ready' });
    expect(await checkDraft(draft({ summary: '' }), deps())).toMatchObject({ ok: false, check: 'ready' });
    expect(await checkDraft(draft({ intent: ' ' }), deps())).toMatchObject({ ok: false, check: 'ready' });
    expect(await checkDraft(draft({ acceptance_test: 'The gatherer costs 11.' }), deps())).toMatchObject({ ok: false, check: 'ready', detail: 'A card on now needs a check: line in its acceptance test' });
  });

  it('refuses a check: line that does not parse', async () => {
    const result = await checkDraft(draft({ acceptance_test: 'check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost = 11' }), deps());
    expect(result).toMatchObject({ ok: false, check: 'check_lines' });
  });

  it('refuses a check that names a kernel path, a folder other than seed-1, or a file outside the lane', async () => {
    const d = deps();
    for (const file of ['seed-1/package.json', 'platform/site/src/lib/copy.json', 'seed-1/sim/rules.ts', 'seed-1/config/../bots/x.json']) {
      const result = await checkDraft(draft({ acceptance_test: `check: config ${file} a == 1` }), d);
      expect(result.ok, file).toBe(false);
      if (!result.ok) expect(['paths', 'check_lines'], file).toContain(result.check);
    }
    expect(await checkDraft(draft({ acceptance_test: 'check: config seed-1/package.json version == "2"', lane: 'code' }), d)).toMatchObject({ ok: false, check: 'paths' });
    expect(await checkDraft(draft({ acceptance_test: 'check: config seed-1/content/extra.txt a == 1' }), d)).toMatchObject({ ok: false, check: 'paths' });
    // No file outside the lane is ever read.
    expect(d.reads).toEqual([]);
  });

  it('refuses a check line that already holds on main', async () => {
    const result = await checkDraft(draft({ acceptance_test: 'check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 10' }), deps());
    expect(result).toEqual({ ok: false, check: 'already_holds', detail: 'already true on main: check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 10' });
    // A file main does not have yet holds nothing.
    expect(await checkDraft(draft({ acceptance_test: 'check: config seed-1/config/new-units.json rows[0].id == "sweeper"' }), deps())).toEqual({ ok: true });
  });

  it('refuses a deny-list hit in any text field, and a scan that cannot run', async () => {
    const hit = await checkDraft(draft(), deps({ scanText: async () => ({ ok: false, detail: 'a deny-list hit: FAIL: banned-phrases hits=1' }) }));
    expect(hit).toEqual({ ok: false, check: 'deny_list', detail: 'a deny-list hit: FAIL: banned-phrases hits=1' });
    const down = await checkDraft(draft(), deps({ scanText: async () => ({ ok: false, detail: 'the deny-list scan could not run: banned-phrases.sh is missing' }) }));
    expect(down).toMatchObject({ ok: false, check: 'deny_list' });
  });

  // docs/specs/unattended-roles.md: approval raises the target by the card's drafting spend.
  it("refuses an estimate whose target, raised by the card's drafting spend and the least a grading needs, rounded up to the cent, passes card_max_usd", async () => {
    expect(draftTotalUsd(2.5, 0.123)).toBe(2.63);
    expect(draftTotalUsd(2.5, 0)).toBe(2.5);
    expect(draftTotalUsd(0.1, 0.0001)).toBe(0.11);
    expect(await checkDraft(draft({ estimate_usd: 1 }), deps({ draftingUsd: 3.6, gradingUsd: 0.35 }))).toEqual({ ok: true });
    expect(await checkDraft(draft({ estimate_usd: 1 }), deps({ draftingUsd: 3.66, gradingUsd: 0.35 }))).toEqual({
      ok: false,
      check: 'estimate',
      detail: "the estimate $1 plus the $3.66 this card's drafting has spent and the $0.35 its grading needs at least comes to $5.01, above the per-card maximum $5",
    });
  });

  it('refuses an estimate above card_max_usd', async () => {
    expect(await checkDraft(draft({ estimate_usd: 5.5 }), deps())).toMatchObject({ ok: false, check: 'estimate' });
    expect(await checkDraft(draft({ estimate_usd: 5 }), deps())).toEqual({ ok: true });
  });

  it('refuses an executor that is not an active, unpaused writer for seed-1', async () => {
    for (const executor of ['Game Designer', 'Tech Artist', 'Platform Builder', 'Nobody']) {
      expect(await checkDraft(draft({ executor }), deps()), executor).toMatchObject({ ok: false, check: 'executor' });
    }
    const paused = ROLES.map((r) => (r.name === 'QA' ? { ...r, paused: true } : r));
    expect(await checkDraft(draft({ executor: 'QA' }), deps({ roles: paused }))).toMatchObject({ ok: false, check: 'executor' });
    expect(seedExecutor('Builder B', ROLES)?.id).toBe('role-builder-b');
  });
});
