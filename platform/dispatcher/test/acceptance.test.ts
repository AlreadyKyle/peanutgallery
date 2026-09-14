import { describe, expect, it } from 'vitest';
import { AcceptanceGrammarError, evaluateCheck, parseChecks, parsePath, resolvePath } from '../src/acceptance.js';

const SPAWN_TABLE = {
  rows: [
    { id: 'gatherer', name: 'Gatherer', baseCost: 10, rate: 0.2 },
    { id: 'cart', name: 'Cart', baseCost: 150, rate: 1.5 },
  ],
};

describe('parsePath', () => {
  it('parses dotted keys, indexes and selectors', () => {
    expect(parsePath('rows[id=gatherer].baseCost')).toEqual([
      { kind: 'key', key: 'rows' },
      { kind: 'match', key: 'id', value: 'gatherer' },
      { kind: 'key', key: 'baseCost' },
    ]);
    expect(parsePath('rows[1].name')).toEqual([
      { kind: 'key', key: 'rows' },
      { kind: 'index', index: 1 },
      { kind: 'key', key: 'name' },
    ]);
    expect(parsePath('unlocks[atTotalDust=100].id')).toEqual([
      { kind: 'key', key: 'unlocks' },
      { kind: 'match', key: 'atTotalDust', value: 100 },
      { kind: 'key', key: 'id' },
    ]);
    expect(parsePath('[0]')).toEqual([{ kind: 'index', index: 0 }]);
  });

  it('rejects malformed paths', () => {
    for (const bad of ['', '.rows', 'rows.', 'rows..id', 'rows[', 'rows[]', 'rows[=x]', 'rows[id=]', 'rows[0]id', 'rows.[0]', 'ro ws']) {
      expect(() => parsePath(bad), bad).toThrow(AcceptanceGrammarError);
    }
  });
});

describe('parseChecks', () => {
  it('extracts config check lines from prose', () => {
    const checks = parseChecks(
      'spawn table row gatherer: baseCost changes from 10 to 11\ncheck: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 11',
    );
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      kind: 'config',
      file: 'seed-1/config/spawn-table.json',
      pathText: 'rows[id=gatherer].baseCost',
      expected: 11,
    });
  });

  it('returns no checks for prose without a check line', () => {
    expect(parseChecks('the cart row is renamed')).toEqual([]);
    expect(parseChecks(null)).toEqual([]);
  });

  it('parses several check lines and JSON values', () => {
    const checks = parseChecks(
      'check: config seed-1/config/spawn-table.json rows[id=cart].name == "Wagon"\ncheck: config seed-1/content/strings.json title == "Dust"',
    );
    expect(checks.map((c) => c.expected)).toEqual(['Wagon', 'Dust']);
  });

  it('throws on an unknown kind, a bad file or a non-JSON value', () => {
    expect(() => parseChecks('check: code seed-1/sim/index.ts x == 1')).toThrow(AcceptanceGrammarError);
    expect(() => parseChecks('check: config ../secrets.json a == 1')).toThrow(AcceptanceGrammarError);
    expect(() => parseChecks('check: config /etc/hosts a == 1')).toThrow(AcceptanceGrammarError);
    expect(() => parseChecks('check: config seed-1/config/spawn-table.json rows[id=cart].name == Wagon')).toThrow(AcceptanceGrammarError);
    expect(() => parseChecks('check: config seed-1/config/spawn-table.json rows[id=cart].name')).toThrow(AcceptanceGrammarError);
  });
});

describe('resolvePath and evaluateCheck', () => {
  it('resolves selectors against the document', () => {
    expect(resolvePath(SPAWN_TABLE, parsePath('rows[id=cart].baseCost'))).toEqual({ found: true, value: 150 });
    expect(resolvePath(SPAWN_TABLE, parsePath('rows[1].id'))).toEqual({ found: true, value: 'cart' });
    expect(resolvePath(SPAWN_TABLE, parsePath('rows[id=mill].baseCost'))).toEqual({ found: false });
    expect(resolvePath(SPAWN_TABLE, parsePath('rows[5]'))).toEqual({ found: false });
    expect(resolvePath(SPAWN_TABLE, parsePath('missing.key'))).toEqual({ found: false });
  });

  it('evaluates false before the change and true after', () => {
    const [check] = parseChecks('check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 11');
    expect(evaluateCheck(check!, SPAWN_TABLE)).toBe(false);
    const changed = { rows: SPAWN_TABLE.rows.map((row) => (row.id === 'gatherer' ? { ...row, baseCost: 11 } : row)) };
    expect(evaluateCheck(check!, changed)).toBe(true);
  });

  it('compares objects and arrays structurally', () => {
    const [check] = parseChecks('check: config seed-1/config/spawn-table.json rows[0] == {"id":"gatherer","name":"Gatherer","baseCost":10,"rate":0.2}');
    expect(evaluateCheck(check!, SPAWN_TABLE)).toBe(true);
    const [listCheck] = parseChecks('check: config seed-1/config/unlocks.json ids == ["a","b"]');
    expect(evaluateCheck(listCheck!, { ids: ['a', 'b'] })).toBe(true);
    expect(evaluateCheck(listCheck!, { ids: ['b', 'a'] })).toBe(false);
  });
});
