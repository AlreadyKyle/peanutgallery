import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ManagedAdapter } from '../src/adapters/managed.js';
import { STUDIO_KEY_ENV, UnattendedAdapter, type UnattendedOptions } from '../src/adapters/unattended.js';
import { createLogger } from '../src/log.js';
import { parsePriceTable } from '../src/pricing.js';
import { RecordingAlerter } from './helpers/fake-alert.js';
import { FakeDb } from './helpers/fake-db.js';
import { AGENT_ID, ENVIRONMENT_ID, FILES, FakeManagedClient } from './helpers/fake-managed.js';

const SRC = path.resolve(import.meta.dirname, '..', 'src', 'adapters');

function options(overrides: Partial<UnattendedOptions> = {}): UnattendedOptions {
  return {
    client: new FakeManagedClient(),
    files: FILES,
    agentId: AGENT_ID,
    agentVersion: 3,
    environmentId: ENVIRONMENT_ID,
    githubRepo: 'owner/repo',
    readToken: 'github_pat_-fixture-read',
    priceTable: parsePriceTable(JSON.stringify({ 'builder-class': { input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 } })),
    probeModel: 'builder-class',
    db: new FakeDb(),
    patches: null,
    alert: new RecordingAlerter(),
    log: createLogger(new Writable({ write: (_chunk, _enc, cb) => cb() })),
    ...overrides,
  };
}

describe('UnattendedAdapter', () => {
  it('is the managed adapter, in unattended mode, with the managed controls', () => {
    const adapter = new UnattendedAdapter(options());
    expect(adapter).toBeInstanceOf(ManagedAdapter);
    expect(adapter.mode).toBe('unattended');
    expect(adapter.managed).toBe(adapter);
    expect(STUDIO_KEY_ENV).toBe('STUDIO_ANTHROPIC_API_KEY');
  });

  it('refuses to exist without the managed ids, a pinned version or the read-only token', () => {
    expect(() => new UnattendedAdapter(options({ agentId: '' }))).toThrow('the managed agent id, its version and the environment id are required in unattended mode');
    expect(() => new UnattendedAdapter(options({ environmentId: '' }))).toThrow('environment id');
    expect(() => new UnattendedAdapter(options({ agentVersion: 0 }))).toThrow('its version');
    expect(() => new UnattendedAdapter(options({ readToken: '' }))).toThrow('GITHUB_READ_TOKEN is required in unattended mode');
  });

  it('has no process-spawn path: no managed module imports child_process', () => {
    const managed = readdirSync(SRC).filter((file) => file.startsWith('managed') || file === 'unattended.ts' || file === 'read-token.ts');
    expect(managed.sort()).toEqual(['managed-client.ts', 'managed-config.ts', 'managed-meter.ts', 'managed-setup.ts', 'managed.ts', 'read-token.ts', 'unattended.ts']);
    for (const file of managed) {
      const source = readFileSync(path.join(SRC, file), 'utf8');
      expect(source, file).not.toMatch(/child_process|claude-cli\.js'\s*;?\s*$|spawn\(/m);
    }
  });

  it('refuses web, sub-agent and MCP tools named in a role, in either naming', async () => {
    const adapter = new UnattendedAdapter(options());
    const spec = { cardId: 'c', worktree: '/w', prompt: 'p', systemPromptFile: null, model: 'builder-class', folder: 'seed-1' as const, maxTurns: 60, maxBudgetUsd: 3, allowedPaths: ['seed-1/config'] };
    await expect(adapter.preflight({ ...spec, roleTools: ['Read', 'WebFetch'] })).rejects.toThrow('excluded tools: WebFetch');
    await expect(adapter.preflight({ ...spec, roleTools: ['web_search'] })).rejects.toThrow('excluded tools: web_search');
    await expect(adapter.preflight({ ...spec, roleTools: ['Read'], allowedPaths: [] })).rejects.toThrow('lane paths');
    await expect(adapter.preflight({ ...spec, roleTools: ['Read', 'Edit', 'Bash'] })).resolves.toBeUndefined();
  });
});
