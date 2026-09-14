import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBuildSha } from './build-sha.mjs';

// Runs after `vite build`: the config lane is served as the files on disk, so
// config/ and content/ are copied into dist/ byte for byte, and version.json
// lets the smoke test confirm which commit is live.
export const COPIED_FOLDERS = ['config', 'content'];

/**
 * @param {string} packageDir the seed package root holding config/ and content/
 * @param {string} dist the build output directory to write into
 * @returns {{ sha: string, builtAt: string }} the version record written
 */
export function runPostbuild(packageDir, dist) {
  mkdirSync(dist, { recursive: true });
  for (const folder of COPIED_FOLDERS) {
    cpSync(join(packageDir, folder), join(dist, folder), { recursive: true });
  }
  const version = { sha: resolveBuildSha(), builtAt: new Date().toISOString() };
  writeFileSync(join(dist, 'version.json'), `${JSON.stringify(version)}\n`);
  return version;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
  const version = runPostbuild(packageDir, join(packageDir, 'dist'));
  process.stdout.write(`postbuild: copied config and content, wrote version.json for ${version.sha}\n`);
}
