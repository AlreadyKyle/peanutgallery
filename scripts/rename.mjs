#!/usr/bin/env node
// The studio rename (docs/specs/rename.md). The display name "Peanut Gallery" became "Mob Machine"
// (PLAN.md §10 decision 43); the domain peanutgallery.games stays until the board registers a new one.
// This script keeps the list of every file that carries the old name or the domain, in tiers, and
// rewrites a tier on request.
//
// usage (from the repository root):
//   node scripts/rename.mjs                                       inventory, read-only
//   node scripts/rename.mjs --apply --tier 1 --name "New Name" [--domain new.tld]
//                                                                 the domain is rewritten only when
//                                                                 --domain names a different one
//   node scripts/rename.mjs --check                               exit 1 if a tier-1 file still
//                                                                 carries the old name (pnpm verify)
//   node scripts/rename.mjs --check-domain                        the same, and the old domain too:
//                                                                 pnpm verify's line once the domain moves
//
// Only the display name (any case, with a space or a "+" between the words) and the domain are
// rewritten. Internal identifiers such as peanutgallery_backup, studio.peanutgallery.*, the
// @backseat/* packages and the Netlify site slugs are tier 3: counted, never rewritten here.
// History is never rewritten: specs, applied migrations, the posted Terms versions, and the lines in
// KEEP_LINES.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const OLD_NAME = /peanut([ +])gallery/gi;
export const OLD_DOMAIN = /peanutgallery\.games/gi;
const OLD_DOMAIN_TEXT = 'peanutgallery.games';
const IDENT = /peanutgallery|backseat/gi;

// Tier 1: what a player, a contributor, a search engine or an agent sees, and the tests that pin
// it. One pull request, with the board's steps in the spec the same day.
// Tier 2: internal prose, alert titles and fixtures nobody outside sees. Soon after.
export const TIERS = {
  1: [
    'CLAUDE.md',
    'README.md',
    'docs/PLAN.md',
    'docs/ROADMAP.md',
    'docs/SYSTEM.md',
    // The launch post drafts the board posts (docs/specs/announcement.md): the name, and the domain
    // every link points at.
    'docs/launch/README.md',
    'docs/launch/backlash-line.md',
    'docs/launch/reddit-artificial.md',
    'docs/launch/reddit-claudeai.md',
    'docs/launch/reddit-incremental-games.md',
    'docs/launch/show-hn.md',
    'docs/launch/x-thread.md',
    'platform/agents/managed/agent.yaml',
    'platform/agents/managed/environment.yaml',
    'platform/board/e2e/board.spec.ts',
    'platform/board/index.html',
    'platform/board/src/Board.test.tsx',
    'platform/board/src/Board.tsx',
    // The explainer video's social cuts show the site's address on their closing plate
    // (docs/specs/explainer-video.md); re-render them after a domain change.
    'platform/explainer/src/data.ts',
    // The Discord posts' username and the site origin they link to (docs/specs/studio-reports.md).
    'platform/dispatcher/src/config.ts',
    'platform/dispatcher/src/discord.ts',
    'platform/dispatcher/test/config.test.ts',
    'platform/dispatcher/src/worktree.ts',
    'platform/ops/Dockerfile.dispatcher',
    'platform/site/DESIGN.md',
    'platform/site/e2e/landing.spec.ts',
    'platform/site/e2e/pages.spec.ts',
    'platform/site/e2e/previews.spec.ts',
    'platform/site/index.html',
    'platform/site/netlify.toml',
    'platform/site/scripts/live-check.mjs',
    'platform/site/src/App.test.tsx',
    'platform/site/src/index-html.test.ts',
    'platform/site/src/lib/copy.ts',
    'platform/site/src/lib/legal.ts',
    'platform/site/src/styles.css',
    'platform/supabase/lib/directives.ts',
    'platform/supabase/seed/launch-cards.json',
    'platform/supabase/test/board-users.test.ts',
    'platform/supabase/test/directives.test.ts',
    'platform/supabase/test/fixtures/refresh-cards/cards.json',
    'platform/supabase/test/fixtures/refresh-cards/seed-1/content/strings.json',
    'seed-1/CLAUDE.md',
    'seed-1/content/strings.json',
    'seed-1/index.html',
  ],
  2: [
    'KYLE_SETUP.md',
    'docs/BOARD-SETUP.md',
    'platform/dispatcher/src/alert.ts',
    'platform/dispatcher/test/attended.test.ts',
    'platform/dispatcher/test/managed.test.ts',
    'platform/dispatcher/test/pipeline.test.ts',
    'platform/dispatcher/test/session.test.ts',
    'platform/ops/README.md',
    'platform/ops/backups-repo/workflows/backup.yml',
    'platform/ops/dispatcher-alert.service',
    'platform/ops/dispatcher-env.mjs',
    'platform/ops/dispatcher.service',
    'platform/ops/jobs-env.mjs',
    'platform/ops/jobs/controller.mjs',
    'platform/ops/jobs/quota.mjs',
    'platform/ops/mac/run-dispatcher.sh',
    'platform/ops/mac/run-job.sh',
    'platform/ops/peanutgallery-backup.service',
    'platform/ops/peanutgallery-backup.timer',
    'platform/ops/peanutgallery-controller.service',
    'platform/ops/peanutgallery-controller.timer',
    'platform/ops/peanutgallery-job-alert@.service',
    'platform/ops/peanutgallery-quota.service',
    'platform/ops/peanutgallery-quota.timer',
    'platform/ops/test/jobs.test.mjs',
    'platform/ops/test/mac.test.mjs',
    'platform/ops/test/ops.test.mjs',
    'platform/supabase/functions/_shared/agent_system_test.ts',
    'platform/supabase/functions/_shared/agent_upkeep_test.ts',
    'platform/supabase/functions/_shared/agent_workflows_test.ts',
    'platform/supabase/functions/_shared/handler_test.ts',
    'platform/supabase/functions/_shared/migration_test.ts',
    'platform/supabase/functions/_shared/money_logic_test.ts',
    'platform/supabase/functions/_shared/money_safety_test.ts',
    'platform/supabase/functions/_shared/session_test.ts',
    'platform/supabase/functions/_shared/site_snapshot_test.ts',
    'platform/supabase/functions/_shared/split_test.ts',
    'platform/supabase/functions/stripe-webhook/index.ts',
    'platform/supabase/test/env.test.ts',
  ],
};

// Records of what happened. Never rewritten, whatever tier their file is in.
// A posted Terms version's words are what applied to the money given under it: a rename posts a new
// version instead (docs/specs/legal-copy.md, docs/specs/rename.md).
const HISTORY_PREFIXES = ['docs/specs/', 'platform/supabase/migrations/', 'scripts/rename', 'platform/site/src/lib/terms-versions.ts'];
export const KEEP_LINES = [
  'in place of hello@peanutgallery.games', // PLAN §10 decision 37
  'from Peanut Gallery, Backseat Driver, Armchair, Helicopter', // PLAN §10 decision 2
  'renamed from Peanut Gallery to Mob Machine', // PLAN §10 decision 43
  '"Who runs the studio": "Peanut Gallery is operated by', // BOARD-SETUP Done 3 quotes the Terms of 20 September 2026
];

const isHistory = (file) => HISTORY_PREFIXES.some((prefix) => file.startsWith(prefix));
const kept = (line) => KEEP_LINES.some((text) => line.includes(text));
const count = (text, pattern) => (text.match(pattern) ?? []).length;

export function tierOf(file) {
  if (isHistory(file)) return 'history';
  for (const [tier, files] of Object.entries(TIERS)) if (files.includes(file)) return tier;
  return null;
}

// Every file's hits: display name and domain outside kept lines, and internal identifiers.
export function inventory(root, files) {
  const rows = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(join(root, file), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\u0000')) continue;
    let name = 0;
    let domain = 0;
    for (const line of text.split('\n')) {
      if (kept(line)) continue;
      name += count(line, OLD_NAME);
      domain += count(line, OLD_DOMAIN);
    }
    const ident = count(text, IDENT) - count(text, OLD_DOMAIN);
    if (name + domain + ident === 0) continue;
    const tier = tierOf(file);
    rows.push({ file, tier: tier ?? (name + domain > 0 ? 'unclassified' : '3'), name, domain, ident });
  }
  return rows;
}

// The domain is rewritten only when a different one is given: an unchanged domain is left exactly as
// written, so the tests' mixed-case addresses keep testing case-insensitive matching.
export function rewrite(text, { name, domain }) {
  const moved = Boolean(domain) && domain.toLowerCase() !== OLD_DOMAIN_TEXT;
  const change = (line) => (moved ? line.replace(OLD_DOMAIN, domain) : line).replace(OLD_NAME, (_, sep) => name.replaceAll(' ', sep));
  return text
    .split('\n')
    .map((line) => (kept(line) ? line : change(line)))
    .join('\n');
}

export function apply(root, tier, replacement) {
  const changed = [];
  for (const file of TIERS[tier]) {
    const path = join(root, file);
    const before = readFileSync(path, 'utf8');
    const after = rewrite(before, replacement);
    if (after !== before) {
      writeFileSync(path, after);
      changed.push(file);
    }
  }
  return changed;
}

function trackedFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
}

function arg(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

function main(argv) {
  const root = process.cwd();
  const rows = inventory(root, trackedFiles(root));
  const unclassified = rows.filter((row) => row.tier === 'unclassified');

  if (argv.includes('--apply')) {
    const tier = arg(argv, '--tier');
    const name = arg(argv, '--name');
    const domain = arg(argv, '--domain');
    if (!TIERS[tier] || !name) {
      console.error('usage: node scripts/rename.mjs --apply --tier 1|2 --name "New Name" [--domain new.tld]');
      return 2;
    }
    if (unclassified.length > 0) {
      console.error(`refused: unclassified files carry the old name or domain; add them to TIERS first:\n${unclassified.map((row) => `  ${row.file}`).join('\n')}`);
      return 1;
    }
    const changed = apply(root, tier, { name, domain });
    console.log(`tier ${tier}: rewrote ${changed.length} files`);
    for (const file of changed) console.log(`  ${file}`);
    return 0;
  }

  if (argv.includes('--check') || argv.includes('--check-domain')) {
    const domainToo = argv.includes('--check-domain');
    const what = domainToo ? 'the old name or domain' : 'the old name';
    const left = rows.filter((row) => row.tier === '1' && row.name + (domainToo ? row.domain : 0) > 0);
    for (const row of left) console.log(`${row.file}: name ${row.name}${domainToo ? `, domain ${row.domain}` : ''}`);
    console.log(left.length === 0 ? `tier 1 carries ${what} nowhere` : `tier 1 still carries ${what} in ${left.length} files`);
    return left.length === 0 ? 0 : 1;
  }

  for (const tier of ['1', '2', 'unclassified', '3', 'history']) {
    const group = rows.filter((row) => row.tier === tier);
    if (group.length === 0) continue;
    const label = { 1: 'tier 1, public', 2: 'tier 2, internal', 3: 'tier 3, identifiers left as they are', history: 'history, never rewritten', unclassified: 'UNCLASSIFIED: add to TIERS' }[tier];
    console.log(`\n${label} (${group.length} files)`);
    for (const row of group) console.log(`  ${row.file}  name ${row.name}  domain ${row.domain}  identifiers ${row.ident}`);
  }
  return unclassified.length === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
