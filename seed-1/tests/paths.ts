import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = dirname(fileURLToPath(import.meta.url));

export const PACKAGE_DIR = dirname(testsDir);
export const FIXTURE_CONFIG_DIR = join(testsDir, 'fixtures', 'config');
export const LIVE_CONFIG_DIR = join(PACKAGE_DIR, 'config');
export const LIVE_CONTENT_DIR = join(PACKAGE_DIR, 'content');
