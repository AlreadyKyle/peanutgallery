// A role job's typed answer (src/typed-output.ts, docs/specs/agent-workflows.md): exactly one object
// valid against the job's schema, or the session fails.
import { describe, expect, it } from 'vitest';
import { SCHEMA_NAMES, TypedOutput, unwrapAnswer } from '../src/typed-output.js';

const typed = new TypedOutput();

const DRAFT = {
  title: 'Gatherers cost 11',
  summary: 'The gatherer costs one more to build.',
  intent: 'Raise the gatherer base cost by one.',
  acceptance_test: 'check: config seed-1/config/spawn-table.json rows[id=gatherer].baseCost == 11',
  lane: 'config',
  executor: 'Builder A',
  estimate_usd: 0.5,
};
const CARD = '4c2f5a1e-7b3d-4e8a-9f01-2a3b4c5d6e7f';

describe('TypedOutput', () => {
  it('loads the three schemas from platform/agents/schemas and shows each as the prompt names it', () => {
    for (const name of SCHEMA_NAMES) expect(JSON.parse(typed.schemaText(name)).$id).toBe(`${name}.schema.json`);
  });

  it('accepts one valid object, with white space or one fenced block around it', () => {
    expect(typed.parse('card-draft', JSON.stringify(DRAFT))).toEqual({ ok: true, value: DRAFT });
    expect(typed.parse('card-draft', `\n\n${JSON.stringify(DRAFT)}\n`)).toEqual({ ok: true, value: DRAFT });
    expect(typed.parse('card-draft', `\`\`\`json\n${JSON.stringify(DRAFT, null, 2)}\n\`\`\``)).toEqual({ ok: true, value: DRAFT });
    expect(typed.parse('ranking', JSON.stringify({ order: [{ card_id: CARD, reason_code: 'small_and_ready' }] })).ok).toBe(true);
    expect(typed.parse('draft-verdict', JSON.stringify({ result: 'approved', reason_codes: ['fits_pillars'] })).ok).toBe(true);
    expect(typed.parse('draft-verdict', JSON.stringify({ result: 'revise', reason_codes: ['unclear_text'], note: 'Say which unit.' })).ok).toBe(true);
  });

  it('refuses no message, prose, two objects, an array and a bare value', () => {
    for (const text of [null, '', 'Here is the draft.', `${JSON.stringify(DRAFT)}\n${JSON.stringify(DRAFT)}`, `Draft: ${JSON.stringify(DRAFT)}`, JSON.stringify([DRAFT]), '42']) {
      const parsed = typed.parse('card-draft', text);
      expect(parsed.ok, String(text)).toBe(false);
    }
    expect(unwrapAnswer('```json\n{}\n```\n```json\n{}\n```')).toContain('```');
  });

  it('refuses an object the schema does not allow, naming the schema', () => {
    const cases: Array<[Parameters<typeof typed.parse>[0], unknown]> = [
      ['card-draft', { ...DRAFT, funding_target_usd: 1 }],
      ['card-draft', { ...DRAFT, lane: 'art' }],
      ['card-draft', { ...DRAFT, estimate_usd: 0 }],
      ['card-draft', { ...DRAFT, summary: 'x'.repeat(201) }],
      ['ranking', { order: [{ card_id: 'not-a-uuid', reason_code: 'small_and_ready' }] }],
      ['ranking', { order: [{ card_id: CARD, reason_code: 'because' }] }],
      ['draft-verdict', { result: 'approved', reason_codes: ['fits_pillars', 'unclear_text'] }],
      ['draft-verdict', { result: 'approved', reason_codes: ['unclear_text'] }],
      ['draft-verdict', { result: 'revise', reason_codes: ['fits_pillars'] }],
      ['draft-verdict', { result: 'flagged', reason_codes: [] }],
      ['draft-verdict', { result: 'maybe', reason_codes: ['off_pillar'] }],
    ];
    for (const [name, value] of cases) {
      const parsed = typed.parse(name, JSON.stringify(value));
      expect(parsed.ok, JSON.stringify(value)).toBe(false);
      if (!parsed.ok) expect(parsed.error).toContain(`${name}.schema.json`);
    }
  });
});
