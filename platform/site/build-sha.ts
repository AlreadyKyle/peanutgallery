import { execFileSync } from 'node:child_process';

export type ShaEnv = { COMMIT_REF?: string; GITHUB_SHA?: string };

// Netlify sets COMMIT_REF, GitHub Actions sets GITHUB_SHA; a local build asks git.
export function resolveBuildSha(env: ShaEnv, gitHead: () => string): string {
  for (const key of ['COMMIT_REF', 'GITHUB_SHA'] as const) {
    const value = (env[key] ?? '').trim();
    if (value !== '') return value;
  }
  return gitHead().trim();
}

export function gitHead(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
}
