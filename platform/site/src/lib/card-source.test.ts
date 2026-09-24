import { describe, expect, it } from 'vitest';
import { detailDoc, ID } from './card-detail.test-fixture';
import { cardDetailFrom, isCardId, loadCard, parseChecks, type CardDetail } from './card-source';

describe('parseChecks', () => {
  it('keeps each config check line, with a scalar value shown and anything else "changed" (null)', () => {
    const text = [
      'The Cart costs less, and players see it.',
      'check: config seed-1/config/spawn-table.json rows[id=cart].baseCost == 11',
      'check: config seed-1/config/game.json $.enabled == true',
      'check: config seed-1/config/game.json name == "Sweeper"',
      'check: config seed-1/config/game.json list == [1, 2]',
      'check: config seed-1/config/game.json obj == {"a": 1}',
      `check: config seed-1/config/game.json long == "${'x'.repeat(201)}"`,
      'check: config seed-1/config/game.json raw == not json',
      'check: config seed-1/config/game.json empty == null',
    ].join('\n');
    expect(parseChecks(text)).toEqual([
      { file: 'seed-1/config/spawn-table.json', path: 'rows[id=cart].baseCost', value: '11' },
      { file: 'seed-1/config/game.json', path: '$.enabled', value: 'true' },
      { file: 'seed-1/config/game.json', path: 'name', value: '"Sweeper"' },
      { file: 'seed-1/config/game.json', path: 'list', value: null },
      { file: 'seed-1/config/game.json', path: 'obj', value: null },
      { file: 'seed-1/config/game.json', path: 'long', value: null },
      { file: 'seed-1/config/game.json', path: 'raw', value: null },
      { file: 'seed-1/config/game.json', path: 'empty', value: 'null' },
    ]);
  });

  it('leaves out a line whose file or path holds any other character, and other check kinds', () => {
    const text = [
      'check: config seed-1/<script>.json a == 1',
      'check: config seed-1/game.json a;rm == 1',
      'check: config seed-1/game.json a"b == 1',
      'check: page / has text',
      'check: config seed-1/game.json ok == 2',
    ].join('\n');
    expect(parseChecks(text)).toEqual([{ file: 'seed-1/game.json', path: 'ok', value: '2' }]);
    expect(parseChecks(null)).toEqual([]);
    expect(parseChecks('No machine line here.')).toEqual([]);
  });
});

describe('cardDetailFrom and loadCard', () => {
  it('reads a card document, money through the same numeric parse as the snapshot', () => {
    const detail: CardDetail = cardDetailFrom(detailDoc());
    expect(detail.card.title).toBe('A cheaper Cart');
    expect([detail.card.funding_target_usd, detail.card.spent_usd, detail.spent_usd]).toEqual([3, 0.42, 0.42]);
    expect(detail.card.commit_sha).toBe('abc1234def5678900000000000000000000000ff');
    expect(detail.funding).toEqual({ contributors: 2, credited_usd: 3, on_card_usd: 1 });
    expect(detail.supporters).toEqual([{ number: 1, founding: true }, { number: 4, founding: false }]);
    expect(detail.milestones.gate).toBe('passed');
    expect(detail.stopped).toBeNull();
  });

  it('reads a stopped row and rejects a malformed figure', () => {
    const stopped = { card_id: ID, title: 'A cheaper Cart', stage: 'rejected', failing_check: 'smoke', spent_usd: '0.1', funded_usd: '0', credited_usd: '0.5', moved: [], stopped_at: '2026-09-15T02:00:00Z' };
    expect(cardDetailFrom(detailDoc({ stopped })).stopped?.failing_check).toBe('smoke');
    expect(() => cardDetailFrom(detailDoc({ spent_usd: 'lots' }))).toThrow('Malformed numeric value');
    expect(() => cardDetailFrom(detailDoc({ lines: {} }))).toThrow('Malformed lines');
  });

  it('asks /api/card/<id> for a uuid only, answers null for a 404 or a malformed id, and rejects any other failure', async () => {
    const asked: string[] = [];
    const answer = (status: number, body: unknown) =>
      (async (url: string) => {
        asked.push(url);
        return new Response(JSON.stringify(body), { status });
      }) as unknown as typeof fetch;
    expect(isCardId(ID)).toBe(true);
    expect(isCardId('not-a-card')).toBe(false);
    expect(await loadCard('not-a-card', answer(200, detailDoc()))).toBeNull();
    expect(asked).toEqual([]);
    expect((await loadCard(ID.toUpperCase(), answer(200, detailDoc())))?.card.id).toBe(ID);
    expect(asked).toEqual([`/api/card/${ID}`]);
    expect(await loadCard(ID, answer(404, { error: 'There is no card at this address' }))).toBeNull();
    await expect(loadCard(ID, answer(502, { error: 'down' }))).rejects.toThrow('answered 502');
  });
});
