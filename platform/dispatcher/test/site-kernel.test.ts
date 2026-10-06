import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isKernelPath } from '../src/worktree.js';
import { runtimeImports } from './helpers/imports.js';

// The public site's kernel files must not take their data, their routes or their rendering from a
// file a card can change (docs/specs/board-site.md). This test lives in the dispatcher, a kernel
// folder, so no card can weaken it; a card cannot change a kernel file either, so it guards the
// board's own pull requests. What a kernel file may still import from the card lane, and why:
const REPO = path.resolve(import.meta.dirname, '..', '..', '..');
const SITE_SRC = 'platform/site/src';
const CARD_LANE_IMPORTS: Record<string, string> = {
  'platform/site/src/lib/copy.ts': 'names, navigation and loading lines; it states no money rule and labels no figure (checked below)',
  'platform/site/src/components/PageHeader.tsx': 'the h1, the lede and the tab title, from the strings the page passes',
  'platform/site/src/styles.css': "the site's styles, imported once by main.tsx",
  'platform/site/src/lib/freshness.ts': 'reloads a tab restored, returned to or moved to another page when a newer build is live (main.tsx)',
  'platform/site/src/routes.tsx': "the pages App.tsx does not route itself and their top bar links, which App.tsx filters (App.tsx); a board-only design file (platform/gate/design-paths.txt)",
};
const PACKAGES = new Set(['react', 'react-dom', 'react-dom/client', 'react-router-dom']);

function filesUnder(dir: string): string[] {
  return readdirSync(path.join(REPO, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    return statSync(path.join(REPO, rel)).isDirectory() ? filesUnder(rel) : [rel];
  });
}

function resolveRelative(from: string, specifier: string): string {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(path.join(REPO, candidate)) && statSync(path.join(REPO, candidate)).isFile()) return candidate;
  }
  return `${base} (missing)`;
}

const kernelSiteFiles = filesUnder(SITE_SRC).filter((file) => isKernelPath(file) && /\.(ts|tsx)$/.test(file) && !/\.test\.tsx?$/.test(file));

describe('the public site kernel imports only kernel code', () => {
  it('finds the kernel files that read, show, route and link money', () => {
    for (const file of [
      'App.tsx',
      'main.tsx',
      'lib/studio.tsx',
      'lib/source.ts',
      'lib/payment.ts',
      'lib/legal.ts',
      'components/Stat.tsx',
      'components/Funding.tsx',
      'components/Guarded.tsx',
      'components/EventList.tsx',
      'components/DeployList.tsx',
      'pages/Contribute.tsx',
      'pages/Ledger.tsx',
      'pages/Legal.tsx',
      'lib/terms.ts',
      'lib/terms-versions.ts',
      'components/NotFound.tsx',
      'components/MoneyIn.tsx',
      'components/Stopped.tsx',
      'pages/Thanks.tsx',
      'lib/thanks.ts',
      'lib/card-source.ts',
      'lib/lines.ts',
      'components/Supporters.tsx',
      'lib/reports-source.ts',
      'components/ReportFacts.tsx',
    ]) {
      expect(kernelSiteFiles, file).toContain(`${SITE_SRC}/${file}`);
    }
    expect(isKernelPath('platform/site/index.html')).toBe(true);
  });

  it('has every kernel file under platform/site/src import only kernel files, the named card-lane modules and the named packages', () => {
    const offenders: string[] = [];
    for (const file of kernelSiteFiles) {
      for (const specifier of runtimeImports(readFileSync(path.join(REPO, file), 'utf8'))) {
        if (specifier.startsWith('.')) {
          const target = resolveRelative(file, specifier);
          if (!isKernelPath(target) && CARD_LANE_IMPORTS[target] === undefined) offenders.push(`${file} imports ${target}`);
        } else if (!PACKAGES.has(specifier)) {
          offenders.push(`${file} imports ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the card-lane modules it names out of the kernel list, so the list above stays honest', () => {
    for (const file of Object.keys(CARD_LANE_IMPORTS)) {
      expect(existsSync(path.join(REPO, file)), file).toBe(true);
      expect(isKernelPath(file), file).toBe(false);
    }
  });

  it('loads the site from the kernel entry: index.html runs main.tsx and nothing else', () => {
    const html = readFileSync(path.join(REPO, 'platform/site/index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map((match) => [match[1]!.trim(), match[2]!.trim()]);
    expect(scripts).toEqual([['type="module" src="/src/main.tsx"', '']]);
  });

  it('keeps every money statement out of copy.ts, which kernel files may read', () => {
    const copy = readFileSync(path.join(REPO, SITE_SRC, 'lib/copy.ts'), 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    const money = /\d+(\.\d+)?\s*%|\$\s*\d|\b\d+\s+days?\b|\breserve\b|\brefund|\bdispute|\bsplit\b|\bemergency fund\b|\bheld\b|\bstripe\b|\bpayment link\b|client_reference_id|buy\.stripe/i;
    const hits = copy.split('\n').filter((line) => money.test(line));
    expect(hits).toEqual([]);
    expect(copy).not.toMatch(/from '\.\/legal'|\.\.\.legal/);
  });

  it('reads import lines the way the bundler does', () => {
    const found = runtimeImports(
      [
        "import { a } from './a';",
        "import type { B } from './b';",
        "import { type C } from './c';",
        "import { type D, e } from './d';",
        'import {',
        '  k,',
        '  type L,',
        "} from './k';",
        "export { f } from './f';",
        "export type { G } from './g';",
        "import './h.css';",
        "const i = await import('./i');",
        'const j = await import(name);',
      ].join('\n'),
    );
    expect(found.slice(0, -1)).toEqual(['./a', './d', './k', './f', './h.css', './i']);
    expect(found.at(-1)).toMatch(/^<computed import at \d+>$/);
  });
});
