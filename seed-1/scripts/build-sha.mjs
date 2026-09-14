import { execSync } from 'node:child_process';

// The commit the build came from: Netlify sets COMMIT_REF, GitHub Actions sets
// GITHUB_SHA, and a local build asks git. An empty value is skipped.
export function resolveBuildSha() {
  for (const name of ['COMMIT_REF', 'GITHUB_SHA']) {
    const value = process.env[name];
    if (value !== undefined && value.length > 0) return value;
  }
  return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
}
