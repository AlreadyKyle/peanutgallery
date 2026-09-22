// Attended adapter: the Claude Code command line on the founder's subscription, on the founder's Mac.
// The child environment is the allowlist alone, so the session signs in the way the founder's
// machine does and no API key reaches it.
//
// Every session runs in Claude Code's sandbox through --settings (docs/specs/launch-managed.md). The
// card's test code runs on the founder's Mac, where the repository's .env, the GitHub credentials and
// the SSH keys are, so:
// - Bash runs sandboxed, with no network, and fails to start rather than run unsandboxed; a command
//   may not ask to leave the sandbox, and the pnpm-script allowlist still decides what runs;
// - sandboxed commands may read the worktree, the repository's git data, the pnpm store, the corepack
//   cache and the temp folder, and nothing else under the home folder or the repository; they may
//   write only the worktree and the temp folder; they reach no host, and the only socket they may use
//   is tsx's IPC folder; git in them reads no global or system configuration;
// - the Read, Glob and Grep tools, which the sandbox does not cover, are denied the credential paths,
//   the repository's .env files and the dispatcher's own code; Edit and Write are allowed only in the
//   worktree.
// Dependencies are installed before the session, outside it, so the session never needs the network.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { absoluteRulePath, ClaudeCliAdapter, childEnv, type ClaudeCliOptions } from './claude-cli.js';
import type { SessionSpec } from './types.js';

const execFileAsync = promisify(execFile);
// The install before a session, with its own timeout.
export const INSTALL_TIMEOUT_MS = 10 * 60_000;

export type Installer = (worktree: string) => Promise<void>;

export interface AttendedOptions extends ClaudeCliOptions {
  // The checkout the dispatcher runs git in; the sandbox hides it apart from the card's worktree.
  repoRoot?: string;
  home?: string;
  tmpdir?: string;
  uid?: number | string;
  // Installs the worktree's dependencies before the session; tests pass a stub.
  install?: Installer;
}

// pnpm install from the lockfile, offline first, with the session's allowlisted environment.
export const pnpmInstall: Installer = async (worktree) => {
  await execFileAsync('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], {
    cwd: worktree,
    env: childEnv(process.env),
    timeout: INSTALL_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
};

export const SESSION_GIT_ENV: Readonly<Record<string, string>> = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

export interface SandboxPaths {
  worktree: string;
  repoRoot: string;
  home: string;
  tmpdir: string;
  // What tsx names its IPC folder after: the effective uid, or the user name where there is none.
  uid: number | string;
}

export function currentUid(): number | string {
  return typeof process.geteuid === 'function' ? process.geteuid() : os.userInfo().username;
}

// The credential paths the Read, Glob and Grep tools may never open, relative to the home folder.
export const HOME_DENY: readonly string[] = [
  '.ssh/**',
  '.config/**',
  '.supabase/**',
  'Library/Preferences/netlify/**',
  '.docker/**',
  '.oci/**',
  'Library/Keychains/**',
  '.aws/**',
  '.claude/**',
  '.claude.json',
  '.netrc',
  '.npmrc',
];

// The settings an attended session runs with.
export function attendedSettings(paths: SandboxPaths): Record<string, unknown> {
  const worktree = path.resolve(paths.worktree);
  const repoRoot = path.resolve(paths.repoRoot);
  const home = path.resolve(paths.home);
  const tmpdir = path.resolve(paths.tmpdir);
  return {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: false,
      // No host at all. The one socket allowed is tsx's own IPC folder, which the seed's bot command
      // line (tsx) listens on to talk to its child. Inside the sandbox Claude Code sets TMPDIR to its
      // own /tmp/claude-<uid> (/private/tmp on macOS), so tsx's folder is there; the dispatcher's own
      // temp folder is listed too.
      network: {
        allowedDomains: [],
        allowUnixSockets: [`/tmp/claude-${paths.uid}/tsx-${paths.uid}`, `/private/tmp/claude-${paths.uid}/tsx-${paths.uid}`, path.join(tmpdir, `tsx-${paths.uid}`)],
      },
      filesystem: {
        denyRead: [home, repoRoot],
        allowRead: [
          worktree,
          // The worktree's git data lives in the repository's .git (worktrees/<card> and the objects),
          // so the card's scripts can run git; it holds no credential (the dispatcher passes its token
          // in git's environment, never in a file).
          path.join(repoRoot, '.git'),
          path.join(home, 'Library', 'pnpm', 'store'),
          path.join(home, '.cache', 'node', 'corepack'),
          path.join(home, 'Library', 'Caches', 'node', 'corepack'),
          tmpdir,
        ],
        allowWrite: [worktree, tmpdir],
      },
    },
    permissions: {
      deny: [
        ...HOME_DENY.map((relative) => `Read(~/${relative})`),
        `Read(${absoluteRulePath(repoRoot)}/.env*)`,
        `Read(${absoluteRulePath(repoRoot)}/platform/dispatcher/**)`,
        `Edit(${absoluteRulePath(repoRoot)}/.git/**)`,
      ],
    },
  };
}

export class AttendedAdapter extends ClaudeCliAdapter {
  readonly mode = 'attended' as const;
  private readonly paths: Omit<SandboxPaths, 'worktree'>;
  private readonly install: Installer;

  constructor(options: AttendedOptions) {
    super(options);
    this.paths = {
      repoRoot: options.repoRoot ?? process.cwd(),
      home: options.home ?? os.homedir(),
      tmpdir: options.tmpdir ?? process.env.TMPDIR ?? os.tmpdir(),
      uid: options.uid ?? currentUid(),
    };
    this.install = options.install ?? pnpmInstall;
  }

  // The allowlisted environment, with git told to read no global or system configuration: the sandbox
  // hides ~/.gitconfig, and a credential helper configured there must not be used.
  protected sessionEnv(): NodeJS.ProcessEnv {
    return { ...childEnv(process.env), ...SESSION_GIT_ENV };
  }

  protected override sessionSettings(spec: SessionSpec): { settings: string | null; editRoot: string | null } {
    return { settings: JSON.stringify(attendedSettings({ ...this.paths, worktree: spec.worktree })), editRoot: spec.worktree };
  }

  // Only a session that can run Bash runs the card's scripts and needs its dependencies, and only a
  // checkout with a lockfile has any to install.
  protected override prepare(spec: SessionSpec): Promise<void> | void {
    if (!spec.roleTools.some((tool) => tool === 'Bash' || tool.startsWith('Bash('))) return;
    if (!existsSync(path.join(spec.worktree, 'pnpm-lock.yaml'))) return;
    return this.install(spec.worktree);
  }
}

export {
  CHILD_ENV_NAMES,
  CHILD_ENV_PREFIXES,
  CHILD_ENV_SWITCHES,
  DISALLOWED_TOOLS,
  EXCLUDED_MANAGED_TOOLS,
  EXCLUDED_TOOLS,
  MCP_PREFIX,
  allowedToolRules,
  baseToolNames,
  childEnv,
  claudeArgs,
  refusedTools,
} from './claude-cli.js';
export type { SpawnFn } from './claude-cli.js';
