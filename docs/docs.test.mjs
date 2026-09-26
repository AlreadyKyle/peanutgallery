// Drift guard for the docs (docs/specs/docs-truth.md, docs/specs/launch-docs.md). Checks that spec
// statuses are well formed; that docs/ROADMAP.md shows each linked spec at the status the spec itself
// declares; that the protected-paths list in seed-1/CLAUDE.md matches the gate's kernel list; that
// the docs and prompts name no company other than the footer's Clayhouse credit; that docs/PLAN.md,
// CLAUDE.md, the prompts and the site's fixed rules name every kernel item; that every "PLAN.md §"
// citation in the repository lands on a section that exists; that docs/BACKLOG.md parses in the
// format the backlog script reads, and that every mechanic PLAN lists as not built maps to one of its
// entries; and that the plan, the checklist, the backlog, the board's steps and the prompts carry no
// week, day, hour, sprint or season numbers.
// Run from the repo root: node --test docs/docs.test.mjs
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const docsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(docsDir, '..');
const specsDir = join(docsDir, 'specs');

const STATUSES = ['draft', 'agreed', 'built', 'done'];

const read = (...parts) => readFileSync(join(repoRoot, ...parts), 'utf8');

function specFiles() {
  return readdirSync(specsDir)
    .filter((file) => file.endsWith('.md') && file !== 'TEMPLATE.md')
    .sort();
}

// The word after "Status:" on the spec's status line, or null when the line is missing.
function specStatus(file) {
  const match = /^Status: ([a-z]+)\./m.exec(readFileSync(join(specsDir, file), 'utf8'));
  return match ? match[1] : null;
}

test('every spec has a Status line with draft, agreed, built or done', () => {
  const files = specFiles();
  assert.ok(files.length > 0, 'docs/specs holds specs');
  for (const file of files) {
    const status = specStatus(file);
    assert.ok(status !== null, `${file} has a line starting "Status: <word>."`);
    assert.ok(STATUSES.includes(status), `${file} status "${status}" is one of ${STATUSES.join(', ')}`);
  }
});

// Table rows of docs/ROADMAP.md that name a spec by path, as { line, path, cells, index }, where
// index is the cell holding the path. Rows for specs that live only in an open pull request name
// the spec by its branch instead of a path, so they are not returned.
function roadmapSpecRows() {
  const rows = [];
  for (const line of read('docs', 'ROADMAP.md').split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    const index = cells.findIndex((cell) => /`specs\/[a-z0-9-]+\.md`/.test(cell));
    if (index === -1) continue;
    const path = /`specs\/([a-z0-9-]+\.md)`/.exec(cells[index])[1];
    rows.push({ line, path, cells, index });
  }
  return rows;
}

test('every ROADMAP row that names a spec path shows the status the spec declares', () => {
  const rows = roadmapSpecRows();
  assert.ok(rows.length > 0, 'docs/ROADMAP.md has table rows naming specs');
  for (const { line, path, cells, index } of rows) {
    assert.ok(existsSync(join(specsDir, path)), `ROADMAP names specs/${path}, which exists (name the branch for a spec not on this branch): ${line}`);
    const statusCell = cells[index + 1] ?? '';
    const shown = /^[a-z]+/.exec(statusCell)?.[0] ?? '';
    assert.equal(shown, specStatus(path), `ROADMAP shows specs/${path} as "${shown}", the spec says "${specStatus(path)}": ${line}`);
  }
});

// The backticked seed-1 paths in the Protected paths section, trailing slashes dropped. The
// section also names platform/gate/kernel-paths.txt, which is not a seed-1 path.
function seedProtectedPaths() {
  const text = read('seed-1', 'CLAUDE.md');
  const section = /^## Protected paths\n([\s\S]*?)(?=^## )/m.exec(text);
  assert.ok(section, 'seed-1/CLAUDE.md has a "## Protected paths" section');
  return [...section[1].matchAll(/`([^`]+)`/g)]
    .map((match) => match[1])
    .filter((path) => !path.startsWith('platform/'))
    .map((path) => path.replace(/\/$/, ''))
    .sort();
}

test('the protected paths in seed-1/CLAUDE.md equal the seed-1 entries of the kernel list', () => {
  const kernel = read('platform', 'gate', 'kernel-paths.txt')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('seed-1/'))
    .map((line) => line.slice('seed-1/'.length))
    .sort();
  assert.ok(kernel.length > 0, 'the kernel list has seed-1 entries');
  assert.deepEqual(seedProtectedPaths(), kernel);
});

// Every Markdown file under a folder, as paths relative to the repository root.
function markdownUnder(...parts) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.md')) out.push(relative(repoRoot, path));
    }
  };
  walk(join(repoRoot, ...parts));
  return out;
}

const PROMPT_FILES = markdownUnder('platform', 'agents', 'prompts');

// The company guard reads the root docs, every Markdown file under docs/ (specs, the board's steps,
// launch drafts), and the agents' prompts. This test file is not Markdown, so the guard's own
// patterns below never trip it.
const GUARDED_DOCS = ['README.md', 'CLAUDE.md', ...markdownUnder('docs'), ...PROMPT_FILES];

// The founder's other company names, as sha256 digests of their lowercase spelling, so this file
// never carries them in plain text: the gate's banned-phrases scan reads docs/ and refuses the
// name (platform/gate/denylist/hashed.txt). Each digest is checked against every window of its
// length in every lowercased line, with runs of whitespace collapsed, so a name is found inside a
// longer word, an address or a domain as well as on its own.
const COMPANY_DIGESTS = [
  { length: 12, digest: '5f71ec6a9bbf350f95caf4a4cb1ace6e10607f6d997d71699aeb0c8fd0bc411e' },
  { length: 19, digest: 'f4062b184f5c5035d54a39d40322d9770d35059b6fe96c60c4de0830dc30fca2' },
];

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function namesCompany(line) {
  const text = line.toLowerCase().replace(/\s+/g, ' ');
  return COMPANY_DIGESTS.some(({ length, digest }) => {
    for (let start = 0; start + length <= text.length; start += 1) {
      if (sha256(text.slice(start, start + length)) === digest) return true;
    }
    return false;
  });
}

test("the docs and prompts name none of the founder's other companies, and Clayhouse only as the footer credit and the contact address", () => {
  assert.ok(GUARDED_DOCS.includes(join('docs', 'BOARD-SETUP.md')), 'the guard reads docs/BOARD-SETUP.md');
  assert.ok(GUARDED_DOCS.some((file) => file.startsWith(join('docs', 'specs'))), 'the guard reads docs/specs');
  for (const file of GUARDED_DOCS) {
    const lines = read(file).split('\n');
    lines.forEach((line, number) => {
      const where = `${file}:${number + 1}`;
      assert.ok(!namesCompany(line), `${where} names one of the founder's other companies`);
      if (/clayhouse/i.test(line)) {
        assert.match(line, /"Created by Clayhouse"|hello@clayhouse\.studio/, `${where} names Clayhouse outside the footer credit and the contact address`);
      }
    });
  }
});

// ---------------------------------------------------------------- the kernel

// Each kernel item as PLAN.md names it, with the plain-language form the site's fixed rules use.
// The broadcast delay and the kill switch bind a stream that does not exist yet, so the site's
// fixed rules may leave them out (copy: null).
const KERNEL_ITEMS = [
  { item: 'the ledger', text: /\bledger\b/i, copy: /\bledger\b/i },
  { item: 'spend caps', text: /spend caps/i, copy: /\bcaps\b/i },
  { item: 'the default 80/20 split', text: /80\/20 split/i, copy: /80%[^.]*20%/ },
  { item: 'the 10% reserve', text: /10% reserve/i, copy: /10%[^.]*reserve/i },
  { item: 'the incident reserve', text: /incident reserve/i, copy: /emergency fund/i },
  { item: 'the gate', text: /\bthe gate\b/i, copy: /automated checks/i },
  { item: 'rollback', text: /\brollback\b/i, copy: /rolled back/i },
  { item: 'the content filter', text: /content filter/i, copy: /content filter/i },
  { item: 'the all-ages rating', text: /all-ages rating/i, copy: /all-ages/i },
  { item: 'the art policy', text: /art policy/i, copy: /art policy/i },
  { item: 'the broadcast delay', text: /broadcast delay/i, copy: null },
  { item: 'the kill switch', text: /kill switch/i, copy: null },
  { item: 'the read/write separation', text: /read\/write separation/i, copy: /reads text from the public/i },
];

// The kernel paragraph, carried over verbatim from the kick-off plan (22 September 2026), with the Scout
// renamed Biz Dev (23 September 2026).
const KERNEL_PARAGRAPH =
  'Not editable by any card, vote, regime or org change, at any tier, and the site says so: the ledger; spend caps; the default 80/20 split and the 10% reserve (each supporter sets their own split at checkout; the default is not votable); the incident reserve rule; the gate; rollback; the content filter, the all-ages rating and the art policy; the broadcast delay and kill switch; and the read/write separation: no agent with write access to a build, a card or the org chart reads free text from the public. The Host, the Community agent and Biz Dev read outside text and have no write tools. The single exception is board notes: free text from the board\'s authenticated accounts, read by the Studio Head.';

const planText = read('docs', 'PLAN.md');
const planLines = planText.split('\n');

// PLAN.md's structure: numbered sections ("## 4. Mechanics and kernel"), their level-3 headings,
// the appendices, and the numbered decisions in §10.
function planOutline() {
  const sections = new Map();
  const appendices = new Set();
  let current = null;
  for (const line of planLines) {
    const section = /^## (\d+)\. (.+)$/.exec(line);
    if (section) {
      current = { title: section[2], headings: [], lines: [] };
      sections.set(Number(section[1]), current);
      continue;
    }
    const appendix = /^## Appendix ([A-Z])\b/.exec(line);
    if (appendix) {
      appendices.add(appendix[1]);
      current = null;
      continue;
    }
    if (/^## /.test(line)) {
      current = null;
      continue;
    }
    if (!current) continue;
    const heading = /^### (.+)$/.exec(line);
    if (heading) current.headings.push(heading[1]);
    current.lines.push(line);
  }
  const decisions = (sections.get(10)?.lines ?? [])
    .map((line) => /^(\d+)\. /.exec(line))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  return { sections, appendices, decisions };
}

const outline = planOutline();

// The body of a level-3 section of PLAN.md, up to the next heading.
function planSubsection(name) {
  const start = planLines.indexOf(`### ${name}`);
  assert.ok(start !== -1, `docs/PLAN.md has a "### ${name}" heading`);
  const rest = planLines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{2,3} /.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

test('docs/PLAN.md keeps the kernel paragraph verbatim under its Kernel heading', () => {
  assert.equal(outline.sections.get(4)?.title, 'Mechanics and kernel', '§4 is still the mechanics and the kernel');
  assert.ok(outline.sections.get(4).headings.includes('Kernel'), '§4 has a "### Kernel" heading');
  assert.ok(outline.sections.get(4).headings.includes('The Board'), '§4 has a "### The Board" heading');
  assert.ok(planSubsection('Kernel').includes(KERNEL_PARAGRAPH), 'the kernel paragraph is unchanged');
});

test('docs/PLAN.md, CLAUDE.md and every prompt name every kernel item', () => {
  const sources = [
    ['docs/PLAN.md Kernel', planSubsection('Kernel')],
    ['CLAUDE.md kernel line', read('CLAUDE.md').split('\n').find((line) => line.startsWith('Rules that never change')) ?? ''],
    ...PROMPT_FILES.map((file) => [`${file} kernel line`, read(file).split('\n').find((line) => line.startsWith('Rules that never change')) ?? '']),
  ];
  for (const [where, text] of sources) {
    assert.ok(text.length > 0, `${where} exists`);
    for (const { item, text: pattern } of KERNEL_ITEMS) {
      assert.match(text, pattern, `${where} names ${item}`);
    }
  }
});

test("the site's fixed rules name every kernel item except the broadcast delay and kill switch", () => {
  // The fixed rules are in the kernel file legal.ts (docs/specs/board-site.md), which every page reads directly.
  const copy = read('platform', 'site', 'src', 'lib', 'legal.ts');
  const block = /fixedRules:\s*\[([\s\S]*?)\]/.exec(copy);
  assert.ok(block, 'platform/site/src/lib/legal.ts has a fixedRules list');
  for (const { item, copy: pattern } of KERNEL_ITEMS) {
    if (pattern) assert.match(block[1], pattern, `the fixed rules name ${item}`);
  }
});

// ---------------------------------------------------------------- PLAN.md citations

const TEXT_FILE = /\.(md|ts|tsx|mts|js|mjs|cjs|sql|sh|txt|yml|yaml|json|toml|example)$/;

// Tracked text files, docs/PLAN.md included, so its own citations are checked too.
function trackedTextFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' });
  return out
    .split('\0')
    .filter((file) => file && (TEXT_FILE.test(file) || file.endsWith('.env.example')))
    .filter((file) => existsSync(join(repoRoot, file)));
}

test('every section, decision and appendix citation in the repository lands on a part of docs/PLAN.md that exists', () => {
  const problems = [];
  for (const file of trackedTextFiles()) {
    const lines = read(file).split('\n');
    lines.forEach((line, index) => {
      const where = `${file}:${index + 1}`;
      for (const match of line.matchAll(/§\s?(\d+)(?:\s+(?:defaults?|decisions?)\s+(\d+)(?:[–-](\d+))?)?(?:\s+([A-Z][A-Za-z]*))?/g)) {
        const section = outline.sections.get(Number(match[1]));
        if (!section) {
          problems.push(`${where}: §${match[1]} is not a section of docs/PLAN.md`);
          continue;
        }
        for (const n of [match[2], match[3]].filter(Boolean)) {
          if (Number(match[1]) !== 10 || !outline.decisions.includes(Number(n))) problems.push(`${where}: §${match[1]} decision ${n} does not exist`);
        }
        const word = match[4];
        if (word && !match[2] && !section.title.startsWith(word) && !section.headings.some((heading) => heading.startsWith(word))) {
          problems.push(`${where}: §${match[1]} has no title or heading starting "${word}"`);
        }
      }
      for (const match of line.matchAll(/Appendix ([A-Z])\b/g)) {
        if (!outline.appendices.has(match[1])) problems.push(`${where}: Appendix ${match[1]} is not in docs/PLAN.md`);
      }
    });
  }
  assert.deepEqual(problems, []);
});

test('docs/PLAN.md numbers its decisions from 1 with no gaps, and the live docs cite no PLAN.md line numbers', () => {
  const { decisions } = outline;
  assert.ok(decisions.length >= 35, `§10 holds the decisions (found ${decisions.length})`);
  assert.deepEqual(decisions, decisions.map((_, index) => index + 1));
  const live = ['README.md', 'CLAUDE.md', 'docs/ROADMAP.md', 'docs/BOARD-SETUP.md', 'docs/BACKLOG.md', 'docs/PLAN.md', 'docs/SYSTEM.md', ...PROMPT_FILES];
  for (const file of live) {
    assert.doesNotMatch(read(file), /PLAN\.md:\d/, `${file} cites PLAN.md by line number; cite a section instead`);
  }
});

// ---------------------------------------------------------------- the backlog

const BUCKETS = ['game', 'platform', 'qa', 'studio', 'budget', 'agents'];
const FOLDERS = ['seed-1', 'platform'];
const HORIZONS = ['next', 'later'];
const KEYS = ['bucket', 'folder', 'horizon', 'rank', 'summary', 'intent'];

// A local reading of docs/BACKLOG.md in the format platform/supabase/lib/backlog.ts parses: prose,
// level-2 headings and fenced blocks are ignored; each level-3 heading is a card title, followed at
// once by the six bullet lines in order. Returns { entries, problems }.
function parseBacklogLocally(text) {
  const lines = text.split('\n');
  const entries = [];
  const problems = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = /^###\s+(.*)$/.exec(lines[i]);
    if (!heading) continue;
    const title = heading[1].trim();
    const at = `docs/BACKLOG.md:${i + 1} "${title}"`;
    if (title === '' || title.length > 80) problems.push(`${at}: a title has 1 to 80 characters`);
    if (title.includes('—')) problems.push(`${at}: the title uses an em dash`);
    const values = {};
    for (const [offset, key] of KEYS.entries()) {
      const match = new RegExp(`^- ${key}: (.*)$`).exec(lines[i + 1 + offset] ?? '');
      if (!match) {
        problems.push(`${at}: line ${i + 2 + offset} should be "- ${key}: <value>"`);
        break;
      }
      values[key] = match[1].trim();
    }
    if (Object.keys(values).length !== KEYS.length) continue;
    if (/^- [a-z_]+:/.test(lines[i + 1 + KEYS.length] ?? '')) problems.push(`${at}: a key follows intent`);
    if (!BUCKETS.includes(values.bucket)) problems.push(`${at}: bucket "${values.bucket}"`);
    if (!FOLDERS.includes(values.folder)) problems.push(`${at}: folder "${values.folder}"`);
    if (!HORIZONS.includes(values.horizon)) problems.push(`${at}: horizon "${values.horizon}"`);
    if (!/^\d+$/.test(values.rank)) problems.push(`${at}: rank "${values.rank}"`);
    if (values.summary === '' || values.summary.length > 200) problems.push(`${at}: the summary has 1 to 200 characters`);
    if (/^[a-z]/.test(values.summary)) problems.push(`${at}: the summary starts in lower case`);
    for (const key of ['summary', 'intent']) {
      if (values[key].includes('—')) problems.push(`${at}: the ${key} uses an em dash`);
    }
    if (!/not built yet/i.test(values.intent)) problems.push(`${at}: the intent does not say it is not built yet`);
    entries.push({ title, ...values, rank: Number(values.rank), line: i + 1 });
  }
  const titles = new Set();
  const ranks = new Set();
  for (const entry of entries) {
    if (titles.has(entry.title)) problems.push(`the title "${entry.title}" appears twice`);
    titles.add(entry.title);
    const key = `${entry.horizon} ${entry.rank}`;
    if (ranks.has(key)) problems.push(`rank ${entry.rank} appears twice on ${entry.horizon}`);
    ranks.add(key);
  }
  if (entries.length === 0) problems.push('docs/BACKLOG.md has no cards');
  return { entries, problems };
}

const backlogText = read('docs', 'BACKLOG.md');
const backlog = parseBacklogLocally(backlogText);

// GitHub's heading anchor: lower case, punctuation other than hyphens dropped, spaces as hyphens.
const slug = (title) => title.toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-');

test('docs/BACKLOG.md parses in the backlog format, with unique titles and ranks, and every intent says it is not built yet', () => {
  assert.deepEqual(backlog.problems, []);
  const count = (horizon) => backlog.entries.filter((entry) => entry.horizon === horizon).length;
  assert.ok(count('next') > 0 && count('later') > 0, `both horizons have entries (next ${count('next')}, later ${count('later')})`);
  const ranks = (horizon) => backlog.entries.filter((entry) => entry.horizon === horizon).map((entry) => entry.rank);
  for (const horizon of HORIZONS) {
    assert.deepEqual(ranks(horizon), ranks(horizon).map((_, index) => index + 1), `${horizon} ranks run 1, 2, 3 in file order`);
  }
});

// The backlog script's own parser, platform/supabase/lib/backlog.ts, once it is on this branch. It
// is TypeScript, so it runs through the supabase package's tsx.
const DB_PARSER = join(repoRoot, 'platform', 'supabase', 'lib', 'backlog.ts');
const TSX = join(repoRoot, 'platform', 'supabase', 'node_modules', '.bin', 'tsx');

test('docs/BACKLOG.md parses with the backlog script\'s parser to the same entries', { skip: existsSync(DB_PARSER) ? false : 'platform/supabase/lib/backlog.ts is not on this branch' }, () => {
  assert.ok(existsSync(TSX), 'the supabase package has tsx installed (pnpm install)');
  const dir = mkdtempSync(join(tmpdir(), 'docs-backlog-'));
  try {
    const script = join(dir, 'parse.mts');
    writeFileSync(
      script,
      [
        "import { readFileSync } from 'node:fs';",
        `import { parseBacklog } from ${JSON.stringify(pathToFileURL(DB_PARSER).href)};`,
        'const entries = parseBacklog(readFileSync(process.argv[2], "utf8"));',
        'process.stdout.write(JSON.stringify(entries.map(({ title, bucket, folder, horizon, rank, summary, intent }) => ({ title, bucket, folder, horizon, rank, summary, intent }))));',
      ].join('\n'),
    );
    const run = spawnSync(TSX, [script, join(docsDir, 'BACKLOG.md')], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(run.status, 0, `the backlog parser accepts docs/BACKLOG.md:\n${run.stdout}\n${run.stderr}`);
    const theirs = JSON.parse(run.stdout);
    const ours = backlog.entries.map(({ title, bucket, folder, horizon, rank, summary, intent }) => ({ title, bucket, folder, horizon, rank, summary, intent }));
    assert.deepEqual(theirs, ours);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every mechanic docs/PLAN.md lists as not built links a backlog entry, and every backlog entry is listed', () => {
  const list = planSubsection('Not built yet')
    .split('\n')
    .filter((line) => line.startsWith('- '));
  assert.ok(list.length > 0, 'the Not built yet section lists mechanics');
  const byslug = new Map(backlog.entries.map((entry) => [slug(entry.title), entry.title]));
  const listed = new Set();
  for (const line of list) {
    const link = /^- \[([^\]]+)\]\(BACKLOG\.md#([^)]+)\)/.exec(line);
    assert.ok(link, `"${line}" starts with a link to its BACKLOG.md entry`);
    assert.ok(byslug.has(link[2]), `"${line}" links #${link[2]}, which is a BACKLOG.md entry`);
    assert.equal(link[1], byslug.get(link[2]), `"${line}" names its entry by its title`);
    listed.add(link[2]);
  }
  const unlisted = [...byslug.keys()].filter((key) => !listed.has(key));
  assert.deepEqual(unlisted, [], 'every BACKLOG.md entry is listed under PLAN.md §4 Not built yet');
});

test('every link into docs/BACKLOG.md from the docs lands on an entry', () => {
  const anchors = new Set(backlog.entries.map((entry) => slug(entry.title)));
  for (const file of ['README.md', 'CLAUDE.md', ...markdownUnder('docs')]) {
    for (const match of read(file).matchAll(/BACKLOG\.md#([a-z0-9_-]+)/g)) {
      assert.ok(anchors.has(match[1]), `${file} links BACKLOG.md#${match[1]}, which is not an entry`);
    }
  }
});

// ---------------------------------------------------------------- no schedules

// Numbered weeks, days, hours, sprints and seasons are schedules; durations ("14 days", "48 hours")
// are rules and stay. Decision dates are written as dates, which this does not match.
const SCHEDULE = /\b(week|day|hour|sprint|season)[ -]\d+\b|\blaunch day\b/i;

test('the plan, the checklist, the backlog, the board\'s steps, the root docs and the prompts carry no schedule', () => {
  const files = ['docs/PLAN.md', 'docs/ROADMAP.md', 'docs/BACKLOG.md', 'docs/BOARD-SETUP.md', 'docs/SYSTEM.md', 'CLAUDE.md', 'README.md', ...PROMPT_FILES];
  for (const file of files) {
    read(file)
      .split('\n')
      .forEach((line, index) => {
        assert.doesNotMatch(line, SCHEDULE, `${file}:${index + 1} carries a schedule`);
      });
  }
});

test('the prompts mark mechanics that are not built as not running yet', () => {
  for (const role of ['host', 'biz-dev', 'community', 'studio-head', 'game-director', 'qa', 'game-designer', 'platform-director', 'head-of-finance', 'janitor', 'tech-artist', 'hr', 'head-of-product']) {
    assert.match(read('platform', 'agents', 'prompts', `${role}.md`), /not running yet/i, `${role}.md says what is not running yet`);
  }
  for (const file of PROMPT_FILES) {
    assert.doesNotMatch(read(file), /re-vote|wins the vote|activate on day/i, `${file} describes voting or a start day as live`);
  }
  const platformBuilder = read('platform', 'agents', 'prompts', 'platform-builder.md');
  assert.doesNotMatch(platformBuilder, /proposes changes to the card system/i, 'the Platform Builder no longer changes the card system');
  assert.match(platformBuilder, /board work/i, 'the Platform Builder names board work');
});

// ---------------------------------------------------------------- the system map

// docs/SYSTEM.md, the single map (docs/specs/agent-system-core.md): its role table carries every
// role spec's name, class, status and trigger, and nothing else stands in for them.
function systemRoleRows() {
  const lines = read('docs', 'SYSTEM.md').split('\n');
  const start = lines.findIndex((line) => /^\| Role \| Class \| Status \| Trigger \|/.test(line));
  assert.ok(start >= 0, 'docs/SYSTEM.md has the role table');
  const rows = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    rows.push({ name: cells[0], class: cells[1], status: cells[2], trigger: cells[3] });
  }
  return rows;
}

test("docs/SYSTEM.md's role table equals the role specs' name, class, status and trigger", () => {
  const dir = join(repoRoot, 'platform', 'agents');
  const specs = readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')))
    .map((spec) => ({ name: spec.name, class: spec.class, status: spec.status, trigger: spec.trigger ?? '' }));
  const byName = (a, b) => a.name.localeCompare(b.name);
  assert.deepEqual([...systemRoleRows()].sort(byName), [...specs].sort(byName));
});

test('docs/SYSTEM.md marks what a later pull request builds as not built yet, naming its spec', () => {
  const text = read('docs', 'SYSTEM.md');
  for (const spec of ['specs/agent-upkeep.md', 'specs/design-review.md']) {
    assert.match(text, new RegExp(`not built yet[^\\n]*\\x60${spec.replace('.', '\\.')}\\x60`, 'i'), `SYSTEM.md marks ${spec}'s part as not built yet`);
    assert.ok(existsSync(join(repoRoot, 'docs', spec)), `docs/${spec} exists`);
  }
});

test('docs/SYSTEM.md describes the weekly report and the outbound lane studio-reports built, and no longer marks them not built', () => {
  const text = read('docs', 'SYSTEM.md');
  assert.match(text, /## The weekly report and the outbound lane/);
  for (const name of ['weekly-report', 'publish_weekly_report()', 'outbound_posts', 'card_supply()', 'DISCORD_WEBHOOK_SHIPS']) assert.ok(text.includes(name), `SYSTEM.md names ${name}`);
  assert.doesNotMatch(text, /not built yet[^\n]*\x60specs\/studio-reports\.md\x60/i);
});

test('docs/SYSTEM.md names the two role jobs agent-workflows built, and no longer marks them not built', () => {
  const text = read('docs', 'SYSTEM.md');
  for (const job of ['studio_ranking', 'draft_card']) assert.match(text, new RegExp(`\\x60${job}\\x60`), `SYSTEM.md names ${job}`);
  assert.doesNotMatch(text, /not built yet[^\n]*\x60specs\/agent-workflows\.md\x60/i);
  assert.match(text, /## The two role jobs/);
});
