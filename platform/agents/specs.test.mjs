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

const LAUNCH_VALUES = {
  'studio-head': { model: 'MODEL_DIRECTOR', budget_share: 0.1, voice: 'terse', tools: WRITE_SET, metrics: ['estimate_accuracy', 'cost_per_ship'] },
  'game-director': { model: 'MODEL_DIRECTOR', budget_share: 0.1, voice: 'firm', tools: WRITE_SET, metrics: ['estimate_accuracy', 'cost_per_ship'] },
  'builder-a': { model: 'MODEL_BUILDER', budget_share: 0.2, voice: 'plain', tools: WRITE_SET, metrics: ['first_pass_rate', 'cost_per_ship', 'estimate_accuracy'] },
  'builder-b': { model: 'MODEL_BUILDER', budget_share: 0.2, voice: 'brisk', tools: WRITE_SET, metrics: ['first_pass_rate', 'cost_per_ship', 'estimate_accuracy'] },
  'platform-builder': { model: 'MODEL_BUILDER', budget_share: 0.15, voice: 'cautious', tools: WRITE_SET, metrics: ['first_pass_rate', 'cost_per_ship'] },
  qa: { model: 'MODEL_BUILDER', budget_share: 0.15, voice: 'exact', tools: WRITE_SET, metrics: ['first_pass_rate', 'reopen_rate'] },
  host: { model: 'MODEL_HOST', budget_share: 0.05, voice: 'cheerful', tools: [], metrics: ['first_pass_rate', 'cost_per_ship'] },
  scout: { model: 'MODEL_BUILDER', budget_share: 0.025, voice: 'curious', tools: [], metrics: ['first_pass_rate', 'cost_per_ship'] },
  community: { model: 'MODEL_BUILDER', budget_share: 0.025, voice: 'warm', tools: [], metrics: ['first_pass_rate', 'cost_per_ship'] },
};

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
    if (Object.hasOwn(schema, 'pattern')) assert.match(value, new RegExp(schema.pattern), `${where} matches ${schema.pattern}`);
    if (Object.hasOwn(schema, 'enum')) assert.ok(schema.enum.includes(value), `${where} is one of ${schema.enum.join(', ')}`);
  } else if (schema.type === 'number') {
    assert.equal(typeof value, 'number', `${where} is a number`);
    assert.ok(Number.isFinite(value), `${where} is finite`);
    if (Object.hasOwn(schema, 'exclusiveMinimum')) assert.ok(value > schema.exclusiveMinimum, `${where} is above ${schema.exclusiveMinimum}`);
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

test('the README schema names exactly the ten keys and allows no others', () => {
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
  assert.equal(schema.required.length, 10);
});

test('the folder holds exactly the nine launch role files', () => {
  assert.deepEqual(specs.map(({ file }) => file.replace(/\.json$/, '')), Object.keys(LAUNCH_VALUES).sort());
});

for (const { file, spec } of specs) {
  const role = file.replace(/\.json$/, '');

  test(`${file} validates against the schema`, () => {
    assert.deepEqual(Object.keys(spec).sort(), [...schema.required].sort(), `${file} carries exactly the ten keys`);
    for (const key of schema.required) checkValue(schema.properties[key], spec[key], `${file}.${key}`);
  });

  test(`${file} points at an existing prompt for this role`, () => {
    assert.equal(spec.prompt_path, `platform/agents/prompts/${role}.md`);
    assert.ok(existsSync(join(repoRoot, spec.prompt_path)), `${spec.prompt_path} exists`);
  });

  test(`${file} has write_access exactly when it has tools`, () => {
    assert.equal(spec.write_access, spec.tools.length > 0);
  });

  test(`${file} carries the launch values`, () => {
    const expected = LAUNCH_VALUES[role];
    assert.equal(spec.name, spec.title, 'name equals title until the roster is named');
    assert.equal(spec.model, expected.model);
    assert.equal(spec.budget_share, expected.budget_share);
    assert.equal(spec.voice, expected.voice);
    assert.deepEqual(spec.tools, expected.tools);
    assert.deepEqual(spec.metrics, expected.metrics);
  });
}

test('role names are unique across files', () => {
  const names = specs.map(({ spec }) => spec.name);
  assert.equal(new Set(names).size, names.length);
});

test('budget shares across the nine files sum to 1', () => {
  const sum = specs.reduce((total, { spec }) => total + spec.budget_share, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `budget_share sum is ${sum}`);
});

// Prompt content the README promises: the kernel line and the gate section in every prompt,
// the no-write-tools statement for roles without tools, the check-line grammar and the stop
// rule for the roles that build seed cards, the working method for the four write roles that
// build cards, and the pillars copied verbatim from the plan.
const PROMPT_KERNEL_LINE = 'No agent with write access';
const PROMPT_GATE_HEADING = '## How the gate works';
const PROMPT_NO_WRITE_TOOLS = 'You have no write tools';
const CHECK_LINE_GRAMMAR = 'check: config <file> <path> == <json>';
const STOP_RULE = 'Stop when the acceptance check holds';
const CHECK_LINE_ROLES = ['builder-a', 'builder-b', 'qa'];
const WORKING_METHOD_HEADING = '## Working method';
const WORKING_METHOD_STEPS = ['Understand:', 'Plan:', 'Implement:', 'Verify:', 'Report:'];
const WORKING_METHOD_ROLES = ['builder-a', 'builder-b', 'qa', 'platform-builder'];

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
  });

  if (spec.tools.length === 0) {
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
  }
}

test('game-director.md carries the seven pillars verbatim from docs/PLAN.md', () => {
  const spec = specs.find(({ file }) => file === 'game-director.json').spec;
  assert.ok(readPrompt(spec).includes(pillarsFromPlan()), 'the pillars sentence from docs/PLAN.md appears in the prompt');
});
