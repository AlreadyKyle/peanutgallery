import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src/config.js';
import { StartupError } from '../src/exit-code.js';
import { STOP_REASONS, stopReason, stopReasonMessage } from '../src/stop-reason.js';

const SCRIPT = path.resolve(import.meta.dirname, '../../ops/actions/run-dispatcher.sh');

describe('stopReason', () => {
  it('names each startup failure with a fixed phrase', () => {
    const cases: [unknown, string][] = [
      [new ConfigError('GITHUB_REPO is not set'), 'configuration refused'],
      [new StartupError("the repository's git configuration is refused: core.hooksPath", true), 'git configuration refused'],
      [new StartupError('remote.origin.url is unset, not https://github.com/o/r(.git)', true), 'git configuration refused'],
      [new StartupError('the code root /x is writable by this process or incomplete: . (writable)', true), 'code root writable'],
      [new StartupError('no price in PRICE_TABLE_JSON for Builder A (mystery-model)', true), 'role model has no price'],
      [new StartupError('no price for model mystery-model', true), 'role model has no price'],
      [new StartupError('GITHUB_READ_TOKEN cannot read o/r: GET returned 401 (Bad credentials)', true), 'github read token refused'],
      [new StartupError('GITHUB_READ_TOKEN can write to o/r: creating a ref was refused only on validation (422)', true), 'github read token refused'],
      [new StartupError('GITHUB_READ_TOKEN check could not reach GitHub: fetch failed', false), 'github unreachable'],
      [new StartupError('GITHUB_READ_TOKEN could not be checked: GET the repository returned 503', false), 'github unreachable'],
      [
        new StartupError(
          'the managed agent or environment could not be read: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
          true,
        ),
        'anthropic credit balance too low',
      ],
      [new StartupError('the probe session could not be created: 429 enforced_spend_limit_reached', false), 'anthropic usage tier cap reached'],
      [new StartupError('the managed agent or environment could not be read: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}', true), 'anthropic key refused'],
      [new StartupError('the managed agent or environment could not be read: 403 {"error":{"type":"permission_error"}}', true), 'anthropic permission refused'],
      [new StartupError('the managed agent or environment could not be read: 404 {"error":{"type":"not_found_error"}}', true), 'managed agent or environment not found'],
      [new StartupError('managed agent agent_1 version 404 differs from platform/agents/managed/agent.yaml: tools differ', true), 'managed agent or environment differs'],
      [new StartupError('managed environment env_1 differs from platform/agents/managed/environment.yaml: networking', true), 'managed agent or environment differs'],
      [new StartupError('the ledger refused probe rows: sevt_1 0.02 USD', true), 'probe spend not recorded'],
      [new StartupError('startup probe failed: the session stopped with timeout after 0 model request(s)', false), 'startup probe failed'],
      [new StartupError('the managed agent or environment could not be read: 529 overloaded', false), 'anthropic api error'],
      [new Error('something new'), 'unclassified'],
      ['a thrown string', 'unclassified'],
    ];
    for (const [error, reason] of cases) expect(stopReason(error), String(error)).toBe(reason);
  });

  it('prints nothing from the error itself: every phrase is plain lowercase words', () => {
    for (const reason of STOP_REASONS) {
      expect(reason).toMatch(/^[a-z]+( [a-z]+)*$/);
      expect(stopReasonMessage(reason)).toBe(`stop reason: ${reason}`);
    }
  });

  it('is in the Actions host lifecycle list exactly, so each phrase reaches the public log and nothing else does', () => {
    const script = readFileSync(SCRIPT, 'utf8');
    const listed = /\|stop reason: \(([^)]*)\)'/.exec(script)?.[1]?.split('|');
    expect(listed).toEqual([...STOP_REASONS]);
  });
});
