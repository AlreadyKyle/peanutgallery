import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';
import { EXIT_FATAL, EXIT_RETRY, StartupError, exitCodeFor, isFatal } from '../src/exit-code.js';
import { UnknownModelError } from '../src/pricing.js';

const DISPATCHER_DIR = path.resolve(import.meta.dirname, '..');

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

describe('exitCodeFor', () => {
  it('is 78 for the values systemd must not restart and 1 for everything else', () => {
    expect(EXIT_FATAL).toBe(78);
    expect(EXIT_RETRY).toBe(1);
    expect(exitCodeFor(new ConfigError('GITHUB_REPO is not set'))).toBe(78);
    expect(exitCodeFor(new StartupError('startup probe failed: init line lists no tools', true))).toBe(78);
    expect(exitCodeFor(new StartupError('the probe session could not be created: overloaded', false))).toBe(1);
    expect(exitCodeFor(new Error('claude could not start: spawn claude ENOENT'))).toBe(1);
    expect(exitCodeFor(new UnknownModelError('mystery-model'))).toBe(1);
    expect(exitCodeFor('a thrown string')).toBe(1);
    expect(exitCodeFor(null)).toBe(1);
    expect(exitCodeFor({ fatal: 'yes' })).toBe(1);
    expect(isFatal({ fatal: true })).toBe(true);
  });

  it('maps every ConfigError loadConfig throws to 78, the price table included', () => {
    const bad = [
      {},
      { GITHUB_REPO: 'not-a-repo' },
      { GITHUB_REPO: 'owner/repo' },
    ];
    for (const env of bad) {
      const error = thrown(() => loadConfig(env, '/repo'));
      expect(error, JSON.stringify(env)).toBeInstanceOf(ConfigError);
      expect(exitCodeFor(error)).toBe(78);
    }
    const priceTable = thrown(() =>
      loadConfig(
        {
          GITHUB_REPO: 'owner/repo',
          SUPABASE_URL: 'https://db.local',
          SUPABASE_SERVICE_ROLE_KEY: 'service-role',
          GITHUB_TOKEN: 'github-token',
          NETLIFY_AUTH_TOKEN: 'netlify-token',
          NETLIFY_SITE_ID_SEED: 'site-seed',
          NETLIFY_SITE_ID_PLATFORM: 'site-platform',
          MODEL_BUILDER: 'builder-class',
          PRICE_TABLE_JSON: '{"builder-class":',
        },
        '/repo',
      ),
    );
    expect(priceTable).toEqual(new ConfigError('PRICE_TABLE_JSON is not valid JSON'));
    expect(exitCodeFor(priceTable)).toBe(78);
  });
});

describe('the dispatcher process', () => {
  // The entrypoint's command. GITHUB_REPO is the first value loadConfig reads, and dotenv never
  // overrides a variable that is already set, so the process stops at the configuration check
  // before it touches the database, git or claude, whether or not a .env exists.
  it('exits 78 on a configuration error and logs that it will not be restarted', () => {
    const run = spawnSync(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
      cwd: DISPATCHER_DIR,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, GITHUB_REPO: 'not-a-repo' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(run.status, run.stderr).toBe(78);
    const line = run.stdout.split('\n').find((text) => text.includes('dispatcher exited with an error'));
    expect(line, run.stdout).toBeDefined();
    expect(JSON.parse(line!)).toMatchObject({ level: 'error', scope: 'main', error: 'GITHUB_REPO must be owner/repo', exitCode: 78, restart: false });
  }, 60_000);
});
