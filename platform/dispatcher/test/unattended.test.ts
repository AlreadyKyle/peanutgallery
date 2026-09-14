import { describe, expect, it } from 'vitest';
import { UNATTENDED_MESSAGE, UnattendedAdapter } from '../src/adapters/unattended.js';
import type { SessionSpec } from '../src/adapters/types.js';

const spec: SessionSpec = {
  cardId: '00000000-0000-4000-8000-000000000001',
  worktree: '/nonexistent',
  systemPromptFile: null,
  prompt: 'Card 00000000: unattended refusal',
  model: 'builder-class',
  roleTools: ['Read'],
  folder: 'seed-1',
  maxTurns: 1,
  maxBudgetUsd: 0.01,
};

describe('UnattendedAdapter', () => {
  it('refuses preflight', async () => {
    const adapter = new UnattendedAdapter();
    expect(adapter.mode).toBe('unattended');
    await expect(adapter.preflight(spec)).rejects.toThrow(UNATTENDED_MESSAGE);
  });
  it('refuses to run', async () => {
    const adapter = new UnattendedAdapter();
    await expect(adapter.run(spec, () => undefined, new AbortController().signal)).rejects.toThrow(UNATTENDED_MESSAGE);
  });
});
