// Checks every role spec in this folder against the schema in README.md, the
// two cross-file rules, and the launch values from the contract.
// Run from the repo root: node --test platform/agents/specs.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const agentsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(agentsDir, '..', '..');

const WRITE_SET = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'];
// The Studio Head and the two Directors read the repository and write nothing in it (docs/specs/agent-system-core.md).
const READ_SET = ['Read', 'Glob', 'Grep'];
const WRITE_TOOLS = ['Edit', 'Write', 'Bash'];
// The Game Designer reads the repository and runs seed-1's package scripts in a scratch checkout;
// it writes card drafts, never files (docs/specs/agent-workflows.md).
const DESIGNER_SET = ['Read', 'Glob', 'Grep', 'Bash'];
const CLASSES = ['writer', 'planner', 'reviewer', 'read_only', 'web_only'];

// The roster: the nine launch roles and the seven added on 23 September 2026 with no tools and a
// budget_share of 0, each with its place in the launch roster (README.md).
const LAUNCH_VALUES = {
  'studio-head': { model: 'MODEL_DIRECTOR', budget_share: 0.1, voice: 'terse', tools: READ_SET, metrics: ['estimate_accuracy', 'cost_per_ship'], class: 'planner', status: 'running' },
  'game-designer': { model: 'MODEL_DIRECTOR', budget_share: 0, voice: 'precise', tools: DESIGNER_SET, metrics: ['estimate_accuracy', 'first_pass_rate'], class: 'planner', status: 'running' },
  'game-director': { model: 'MODEL_DIRECTOR', budget_share: 0.1, voice: 'firm', tools: READ_SET, metrics: ['estimate_accuracy', 'cost_per_ship'], class: 'reviewer', status: 'running' },
  'builder-a': { model: 'MODEL_BUILDER', budget_share: 0.2, voice: 'plain', tools: WRITE_SET, metrics: ['first_pass_rate', 'cost_per_ship', 'estimate_accuracy'], class: 'writer', status: 'running' },
  'builder-b': { model: 'MODEL_BUILDER', budget_share: 0.2, voice: 'brisk', tools: WRITE_SET, metrics: ['first_pass_rate', 'cost_per_ship', 'estimate_accuracy'], class: 'writer', status: 'running' },
  qa: { model: 'MODEL_BUILDER', budget_share: 0.15, voice: 'exact', tools: WRITE_SET, metrics: ['first_pass_rate', 'reopen_rate'], class: 'writer', status: 'running' },
  'platform-builder': { model: 'MODEL_BUILDER', budget_share: 0.15, voice: 'cautious', tools: WRITE_SET, metrics: ['first_pass_rate', 'cost_per_ship'], class: 'writer', status: 'running' },
  'platform-director': { model: 'MODEL_DIRECTOR', budget_share: 0, voice: 'exacting', tools: READ_SET, metrics: ['first_pass_rate', 'reopen_rate'], class: 'reviewer', status: 'running' },
  'head-of-finance': { model: 'MODEL_DIRECTOR', budget_share: 0, voice: 'careful', tools: [], metrics: ['estimate_accuracy', 'cost_per_ship'], class: 'read_only', status: 'starts' },
  janitor: { model: 'MODEL_BUILDER', budget_share: 0, voice: 'tidy', tools: [], metrics: ['first_pass_rate', 'cost_per_ship'], class: 'read_only', status: 'starts' },
  'tech-artist': { model: 'MODEL_BUILDER', budget_share: 0, voice: 'vivid', tools: [], metrics: ['first_pass_rate', 'cost_per_ship'], class: 'writer', status: 'starts' },
  hr: { model: 'MODEL_DIRECTOR', budget_share: 0, voice: 'fair', tools: [], metrics: ['estimate_accuracy', 'cost_per_ship'], class: 'planner', status: 'starts' },
  'head-of-product': { model: 'MODEL_DIRECTOR', budget_share: 0, voice: 'candid', tools: [], metrics: ['first_pass_rate', 'cost_per_ship'], class: 'web_only', status: 'starts' },
  'biz-dev': { model: 'MODEL_BUILDER', budget_share: 0.025, voice: 'curious', tools: [], metrics: ['first_pass_rate', 'cost_per_ship'], class: 'web_only', status: 'starts' },
  community: { model: 'MODEL_BUILDER', budget_share: 0.025, voice: 'warm', tools: [], metrics: ['first_pass_rate', 'cost_per_ship'], class: 'web_only', status: 'starts' },
  host: { model: 'MODEL_HOST', budget_share: 0.05, voice: 'cheerful', tools: [], metrics: ['first_pass_rate', 'cost_per_ship'], class: 'web_only', status: 'planned' },
};

// The roles that run at launch, from the launch plan's roster.
const RUNNING = ['Studio Head', 'Game Designer', 'Game Director', 'Builder A', 'Builder B', 'QA', 'Platform Builder', 'Platform Director'];

function readSchemaFromReadme() {
  const readme = readFileSync(join(agentsDir, 'README.md'), 'utf8');
  const match = /```json\n([\s\S]*?)\n```/.exec(readme);
  assert.ok(match, 'README.md carries one fenced json block holding the schema');
  return JSON.parse(match[1]);
}

function readSpecs() {
  const names = readdirSync(agentsDir).filter((file) => file.endsWith('.json')).sort();
  return names.map((file) => ({ file, spec: JSON.parse(readFileSync(join(agentsDir, file), 'utf8')) }));
}

// The subset of JSON Schema the README schema uses, applied to one value.
function checkValue(schema, value, where) {
  if (schema.type === 'string') {
    assert.equal(typeof value, 'string', `${where} is a string`);
    if (Object.hasOwn(schema, 'minLength')) assert.ok(value.length >= schema.minLength, `${where} has at least ${schema.minLength} characters`);
    if (Object.hasOwn(schema, 'maxLength')) assert.ok(value.length <= schema.maxLength, `${where} has at most ${schema.maxLength} characters`);
    if (Object.hasOwn(schema, 'pattern')) assert.match(value, new RegExp(schema.pattern), `${where} matches ${schema.pattern}`);
    if (Object.hasOwn(schema, 'enum')) assert.ok(schema.enum.includes(value), `${where} is one of ${schema.enum.join(', ')}`);
  } else if (schema.type === 'number') {
    assert.equal(typeof value, 'number', `${where} is a number`);
    assert.ok(Number.isFinite(value), `${where} is finite`);
    if (Object.hasOwn(schema, 'exclusiveMinimum')) assert.ok(value > schema.exclusiveMinimum, `${where} is above ${schema.exclusiveMinimum}`);
    if (Object.hasOwn(schema, 'minimum')) assert.ok(value >= schema.minimum, `${where} is at least ${schema.minimum}`);
    if (Object.hasOwn(schema, 'maximum')) assert.ok(value <= schema.maximum, `${where} is at most ${schema.maximum}`);
  } else if (schema.type === 'boolean') {
    assert.equal(typeof value, 'boolean', `${where} is a boolean`);
  } else if (schema.type === 'array') {
    assert.ok(Array.isArray(value), `${where} is an array`);
    if (Object.hasOwn(schema, 'minItems')) assert.ok(value.length >= schema.minItems, `${where} has at least ${schema.minItems} items`);
    if (Object.hasOwn(schema, 'maxItems')) assert.ok(value.length <= schema.maxItems, `${where} has at most ${schema.maxItems} items`);
    if (schema.uniqueItems) assert.equal(new Set(value).size, value.length, `${where} has no duplicate items`);
    value.forEach((item, index) => checkValue(schema.items, item, `${where}[${index}]`));
  } else {
    assert.fail(`${where}: schema type ${schema.type} is not handled by this test`);
  }
}

const schema = readSchemaFromReadme();
const specs = readSpecs();

test('the README schema requires thirteen keys, allows trigger besides them, and allows no others', () => {
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual([...schema.required, 'trigger'].sort(), Object.keys(schema.properties).sort());
  assert.equal(schema.required.length, 13);
  assert.ok(schema.required.includes('class'), 'class is required');
  assert.deepEqual(schema.properties.class.enum, CLASSES);
  assert.ok(schema.required.includes('description'), 'description is required');
  assert.ok(schema.required.includes('status'), 'status is required');
  assert.deepEqual(schema.properties.status.enum, ['running', 'starts', 'planned']);
});

test('the folder holds exactly the sixteen roster files', () => {
  assert.deepEqual(specs.map(({ file }) => file.replace(/\.json$/, '')), Object.keys(LAUNCH_VALUES).sort());
});

test('the roles running at launch are the roster the launch plan names', () => {
  const running = specs.filter(({ spec }) => spec.status === 'running').map(({ spec }) => spec.name);
  assert.deepEqual(running.sort(), [...RUNNING].sort());
});

for (const { file, spec } of specs) {
  const role = file.replace(/\.json$/, '');

  test(`${file} validates against the schema`, () => {
    const expected = spec.status === 'running' ? [...schema.required] : [...schema.required, 'trigger'];
    assert.deepEqual(Object.keys(spec).sort(), expected.sort(), `${file} carries the thirteen keys, and trigger exactly when it is not running`);
    for (const key of Object.keys(spec)) checkValue(schema.properties[key], spec[key], `${file}.${key}`);
  });

  test(`${file} points at an existing prompt for this role`, () => {
    assert.equal(spec.prompt_path, `platform/agents/prompts/${role}.md`);
    assert.ok(existsSync(join(repoRoot, spec.prompt_path)), `${spec.prompt_path} exists`);
  });

  test(`${file} has write_access exactly when it is a writer or a planner with tools`, () => {
    assert.equal(spec.write_access, (spec.class === 'writer' || spec.class === 'planner') && spec.tools.length > 0);
  });

  // A role without tools has no job that runs yet; the site shows the description as is.
  if (spec.tools.length === 0) {
    test(`${file} description states the job, not whether the role runs (the site says that once)`, () => {
      assert.ok(!/not running/i.test(spec.description), `${file} description leaves "not running" to the site`);
    });
  }

  test(`${file} carries the launch values`, () => {
    const expected = LAUNCH_VALUES[role];
    assert.equal(spec.name, spec.title, 'name equals title until the roster is named');
    assert.equal(spec.model, expected.model);
    assert.equal(spec.budget_share, expected.budget_share);
    assert.equal(spec.voice, expected.voice);
    assert.deepEqual(spec.tools, expected.tools);
    assert.deepEqual(spec.metrics, expected.metrics);
    assert.equal(spec.class, expected.class);
    assert.equal(spec.status, expected.status);
  });
}

test('the Game Director and the Platform Director hold only Read, Glob and Grep, and the Studio Head holds no write tool', () => {
  const tools = (file) => specs.find((s) => s.file === file).spec.tools;
  assert.deepEqual(tools('game-director.json'), READ_SET);
  assert.deepEqual(tools('platform-director.json'), READ_SET);
  assert.deepEqual(tools('studio-head.json').filter((tool) => WRITE_TOOLS.includes(tool)), []);
});

test('role names are unique across files', () => {
  const names = specs.map(({ spec }) => spec.name);
  assert.equal(new Set(names).size, names.length);
});

// The roles added on 23 September 2026 carry 0 until the operations budget sets every share (README.md).
test('the budget shares of the roles with a share that is not 0 sum to 1', () => {
  const shared = specs.filter(({ spec }) => spec.budget_share !== 0);
  assert.equal(shared.length, 9, 'the nine launch roles keep their shares');
  const sum = shared.reduce((total, { spec }) => total + spec.budget_share, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `budget_share sum is ${sum}`);
});

// Prompt content the README promises: the kernel line and the gate section in every prompt,
// the no-write-tools statement for roles without tools, the check-line grammar and the stop
// rule for the roles that build seed cards, the working method and the kernel-path rule for the
// four write roles that build cards, the revert on main in every gate section, and the pillars
// copied verbatim from the plan.
const PROMPT_KERNEL_LINE = 'No agent with write access';
const PROMPT_GATE_HEADING = '## How the gate works';
const PROMPT_NO_WRITE_TOOLS = 'You have no write tools';
const CHECK_LINE_GRAMMAR = 'check: config <file> <path> == <json>';
const STOP_RULE = 'Stop when the acceptance check holds';
const CHECK_LINE_ROLES = ['builder-a', 'builder-b', 'qa'];
const WORKING_METHOD_HEADING = '## Working method';
const WORKING_METHOD_STEPS = ['Understand:', 'Plan:', 'Implement:', 'Verify:', 'Report:'];
const WORKING_METHOD_ROLES = ['builder-a', 'builder-b', 'qa', 'platform-builder'];
const KERNEL_PATHS_FILE = 'platform/gate/kernel-paths.txt';
const GATE_REVERT = 'a revert commit lands on `main`';

function readPrompt(spec) {
  return readFileSync(join(repoRoot, spec.prompt_path), 'utf8');
}

function pillarsFromPlan() {
  const plan = readFileSync(join(repoRoot, 'docs', 'PLAN.md'), 'utf8');
  const match = /^Seed 1 pillars \([^)]*\)\. (.+)$/m.exec(plan);
  assert.ok(match, 'docs/PLAN.md carries the line starting "Seed 1 pillars"');
  return match[1];
}

for (const { file, spec } of specs) {
  const role = file.replace(/\.json$/, '');

  test(`${file} prompt carries the kernel line and the gate section`, () => {
    const prompt = readPrompt(spec);
    assert.ok(prompt.includes(PROMPT_KERNEL_LINE), `${spec.prompt_path} contains "${PROMPT_KERNEL_LINE}"`);
    assert.ok(prompt.includes(PROMPT_GATE_HEADING), `${spec.prompt_path} contains "${PROMPT_GATE_HEADING}"`);
    assert.ok(prompt.includes(GATE_REVERT), `${spec.prompt_path} contains "${GATE_REVERT}"`);
  });

  if (!spec.tools.some((tool) => WRITE_TOOLS.includes(tool))) {
    test(`${file} prompt states that the role has no write tools`, () => {
      assert.ok(readPrompt(spec).includes(PROMPT_NO_WRITE_TOOLS), `${spec.prompt_path} contains "${PROMPT_NO_WRITE_TOOLS}"`);
    });
  }

  if (CHECK_LINE_ROLES.includes(role)) {
    test(`${file} prompt carries the check-line grammar and the stop rule`, () => {
      const prompt = readPrompt(spec);
      assert.ok(prompt.includes(CHECK_LINE_GRAMMAR), `${spec.prompt_path} contains "${CHECK_LINE_GRAMMAR}"`);
      assert.ok(prompt.includes(STOP_RULE), `${spec.prompt_path} contains "${STOP_RULE}"`);
    });
  }

  if (WORKING_METHOD_ROLES.includes(role)) {
    test(`${file} prompt carries the working method with its five steps`, () => {
      const prompt = readPrompt(spec);
      assert.ok(prompt.includes(WORKING_METHOD_HEADING), `${spec.prompt_path} contains "${WORKING_METHOD_HEADING}"`);
      for (const step of WORKING_METHOD_STEPS) {
        assert.ok(prompt.includes(step), `${spec.prompt_path} contains "${step}"`);
      }
    });

    test(`${file} prompt points at the kernel path list`, () => {
      assert.ok(readPrompt(spec).includes(KERNEL_PATHS_FILE), `${spec.prompt_path} contains "${KERNEL_PATHS_FILE}"`);
    });
  }
}

test('game-director.md carries the seven pillars verbatim from docs/PLAN.md', () => {
  const spec = specs.find(({ file }) => file === 'game-director.json').spec;
  assert.ok(readPrompt(spec).includes(pillarsFromPlan()), 'the pillars sentence from docs/PLAN.md appears in the prompt');
});

// docs/specs/agent-workflows.md: the three roles that run jobs answer with one object valid against
// their schema, the Director grades with the rubric, no role job holds Write or Edit, and the two
// roles that read outside text propose nothing that passes a board review and name no source that
// is neither free nor allowed.
const JOB_SCHEMAS = {
  'studio-head': 'platform/agents/schemas/ranking.schema.json',
  'game-designer': 'platform/agents/schemas/card-draft.schema.json',
  'game-director': 'platform/agents/schemas/draft-verdict.schema.json',
};

for (const [role, schemaPath] of Object.entries(JOB_SCHEMAS)) {
  test(`${role}.md names its schema, which is a JSON Schema object with no other keys allowed`, () => {
    const spec = specs.find(({ file }) => file === `${role}.json`).spec;
    assert.ok(readPrompt(spec).includes(schemaPath), `${spec.prompt_path} names ${schemaPath}`);
    const schema = JSON.parse(readFileSync(join(repoRoot, schemaPath), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
  });
}

test('the Game Designer holds Read, Glob, Grep and Bash, and no role that runs a job holds Write or Edit', () => {
  const tools = (file) => specs.find((s) => s.file === file).spec.tools;
  assert.deepEqual(tools('game-designer.json'), DESIGNER_SET);
  for (const file of ['studio-head.json', 'game-designer.json', 'game-director.json']) {
    assert.deepEqual(tools(file).filter((tool) => tool === 'Write' || tool === 'Edit'), [], file);
  }
});

test('the card draft carries one estimate and no target; the verdict names its reason codes from a closed list', () => {
  const draft = JSON.parse(readFileSync(join(repoRoot, JOB_SCHEMAS['game-designer']), 'utf8'));
  assert.ok(draft.required.includes('estimate_usd'));
  assert.ok(!Object.keys(draft.properties).some((key) => /target/.test(key)), 'no target field');
  const verdict = JSON.parse(readFileSync(join(repoRoot, JOB_SCHEMAS['game-director']), 'utf8'));
  assert.deepEqual(verdict.properties.result.enum, ['approved', 'revise', 'flagged']);
  assert.ok(Array.isArray(verdict.properties.reason_codes.items.enum) && verdict.properties.reason_codes.items.enum.length > 1);
});

test('rubrics/draft-game.md carries the seven pillars and the all-ages rating verbatim from docs/PLAN.md', () => {
  const rubric = readFileSync(join(agentsDir, 'rubrics', 'draft-game.md'), 'utf8');
  assert.ok(rubric.includes(pillarsFromPlan()), 'the pillars sentence');
  const plan = readFileSync(join(repoRoot, 'docs', 'PLAN.md'), 'utf8');
  const rating = /Games meet an ESRB E \/ PEGI 3 bar: [^.]+\./.exec(plan);
  assert.ok(rating, 'docs/PLAN.md states the rating');
  assert.ok(rubric.includes(rating[0]), 'the rating sentence');
  assert.ok(rubric.includes('Answer with one draft-verdict object'), 'the answer line');
  assert.ok(readFileSync(join(repoRoot, 'platform/agents/prompts/game-director.md'), 'utf8').includes('platform/agents/rubrics/draft-game.md'));
});

// docs/specs/design-review.md: both Directors run the visual review, answering one visual-verdict
// object against rubrics/visual.md, whose criteria are the schema's, each with its own closed list of
// reason codes; a pass carries meets, and a frame is named by its side and file name.
const VISUAL_SCHEMA = 'platform/agents/schemas/visual-verdict.schema.json';
const VISUAL_RUBRIC = 'platform/agents/rubrics/visual.md';

test('both Directors name the visual-verdict schema and the visual rubric, and hold only Read, Glob and Grep', () => {
  for (const role of ['game-director', 'platform-director']) {
    const spec = specs.find(({ file }) => file === `${role}.json`).spec;
    const prompt = readPrompt(spec);
    assert.ok(prompt.includes(VISUAL_SCHEMA), `${role}.md names ${VISUAL_SCHEMA}`);
    assert.ok(prompt.includes(VISUAL_RUBRIC), `${role}.md names ${VISUAL_RUBRIC}`);
    assert.deepEqual(spec.tools, READ_SET, `${role} holds only Read, Glob and Grep`);
  }
});

test("the visual verdict's criteria equal the rubric's headings, and each criterion's reason codes are the rubric's", () => {
  const schema = JSON.parse(readFileSync(join(repoRoot, VISUAL_SCHEMA), 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.additionalProperties, false);
  const criteria = schema.properties.criteria;
  assert.equal(criteria.additionalProperties, false);
  assert.deepEqual(criteria.required, ['intent', 'fit', 'legibility', 'all_ages']);
  const rubric = readFileSync(join(repoRoot, VISUAL_RUBRIC), 'utf8');
  const section = rubric.slice(rubric.indexOf('## The criteria'), rubric.indexOf('## The verdict'));
  const headings = [...section.matchAll(/^### (\S+)$/gm)].map((match) => match[1]);
  assert.deepEqual(headings, criteria.required);
  for (const name of criteria.required) {
    const def = schema.$defs[name];
    assert.equal(def.additionalProperties, false, `${name} allows no other keys`);
    assert.deepEqual(def.required, ['verdict', 'frame', 'reason_code']);
    assert.deepEqual(def.properties.verdict.enum, ['pass', 'revise']);
    const codes = def.properties.reason_code.enum;
    assert.equal(codes[0], 'meets', `${name}: a pass carries meets`);
    const text = section.slice(section.indexOf(`### ${name}`)).split('\n### ')[0];
    for (const code of codes.slice(1)) assert.ok(text.includes(code), `the rubric's ${name} names ${code}`);
  }
  assert.match('site/home-375.png', new RegExp(schema.$defs.frame.pattern));
  assert.match('game/game-21600.png', new RegExp(schema.$defs.frame.pattern));
  assert.doesNotMatch('../home-375.png', new RegExp(schema.$defs.frame.pattern));
  for (const line of ['Compare each .before.png with its .after.png', 'never measure sizes, spacing or counts', 'Answer with one visual-verdict object']) {
    assert.ok(rubric.includes(line), `the rubric says: ${line}`);
  }
});

for (const role of ['biz-dev', 'community']) {
  test(`${role}.md proposes nothing for a board review, names no Reddit or X, puts nothing on the ledger page and says it is not running yet`, () => {
    const prompt = readFileSync(join(repoRoot, 'platform', 'agents', 'prompts', `${role}.md`), 'utf8');
    assert.doesNotMatch(prompt, /reddit|subreddit/i);
    assert.ok(!prompt.includes(' X '), 'no X source');
    assert.doesNotMatch(prompt, /board's review/i);
    assert.doesNotMatch(prompt, /ledger page/i);
    assert.match(prompt, /not running yet/);
  });
}
