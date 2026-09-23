// Role spec validation (platform/agents/<role>.json) and model resolution.

import type { Env } from "./env.js";

export const MODEL_ENV_NAMES = ["MODEL_DIRECTOR", "MODEL_BUILDER", "MODEL_HOST"] as const;
export type ModelEnvName = (typeof MODEL_ENV_NAMES)[number];

export const TOOL_NAMES = ["Read", "Edit", "Write", "Glob", "Grep", "Bash"] as const;
export const METRIC_NAMES = ["first_pass_rate", "cost_per_ship", "estimate_accuracy", "reopen_rate"] as const;

const REQUIRED_KEYS = [
  "name",
  "title",
  "description",
  "species_note",
  "model",
  "budget_share",
  "voice",
  "prompt_path",
  "tools",
  "metrics",
  "write_access",
] as const;

/** The longest description roles.description accepts. */
export const DESCRIPTION_MAX = 200;

export interface RoleSpec {
  name: string;
  title: string;
  /** One plain sentence saying what the role does; the Meet the Team page shows it. */
  description: string;
  species_note: string;
  model: ModelEnvName;
  budget_share: number;
  voice: string;
  prompt_path: string;
  tools: string[];
  metrics: string[];
  write_access: boolean;
}

function fail(source: string, message: string): never {
  throw new Error(`${source}: ${message}`);
}

function nonEmptyString(source: string, obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.trim() === "") {
    fail(source, `${key} must be a non-empty string`);
  }
  return value;
}

function stringList(source: string, obj: Record<string, unknown>, key: string, allowed: readonly string[]): string[] {
  const value = obj[key];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    fail(source, `${key} must be an array of strings`);
  }
  const list = value as string[];
  for (const item of list) {
    if (!allowed.includes(item)) fail(source, `${key} contains an unknown value "${item}"`);
  }
  if (new Set(list).size !== list.length) fail(source, `${key} contains a repeated value`);
  return list;
}

/** Validates one role JSON document against the schema in platform/agents/README.md. */
export function parseRoleSpec(raw: unknown, source: string): RoleSpec {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail(source, "must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  for (const key of REQUIRED_KEYS) {
    if (!(key in obj)) fail(source, `missing key ${key}`);
  }
  for (const key of Object.keys(obj)) {
    if (!(REQUIRED_KEYS as readonly string[]).includes(key)) fail(source, `unknown key ${key}`);
  }

  const name = nonEmptyString(source, obj, "name");
  const title = nonEmptyString(source, obj, "title");
  const description = nonEmptyString(source, obj, "description");
  if (description.includes("\n")) fail(source, "description must be one line");
  if (description.length > DESCRIPTION_MAX) fail(source, `description must be ${DESCRIPTION_MAX} characters or fewer`);
  if (description.trim() !== description) fail(source, "description must not start or end with a space");
  if (description.includes("\u2014")) fail(source, "description must not use an em dash");
  const speciesNote = nonEmptyString(source, obj, "species_note");
  if (speciesNote.includes("\n")) fail(source, "species_note must be one line");

  const model = nonEmptyString(source, obj, "model");
  if (!(MODEL_ENV_NAMES as readonly string[]).includes(model)) {
    fail(source, `model must be one of ${MODEL_ENV_NAMES.join(", ")}`);
  }

  const budgetShare = obj.budget_share;
  if (typeof budgetShare !== "number" || !(budgetShare > 0) || budgetShare > 1) {
    fail(source, "budget_share must be a number above 0 and at most 1");
  }

  const voice = nonEmptyString(source, obj, "voice");
  if (!/^[a-z]+$/.test(voice)) fail(source, "voice must be one lowercase word");

  const promptPath = nonEmptyString(source, obj, "prompt_path");
  if (!/^platform\/agents\/prompts\/[a-z-]+\.md$/.test(promptPath)) {
    fail(source, "prompt_path must be platform/agents/prompts/<role>.md");
  }

  const tools = stringList(source, obj, "tools", TOOL_NAMES);
  const metrics = stringList(source, obj, "metrics", METRIC_NAMES);
  if (metrics.length < 2 || metrics.length > 3) fail(source, "metrics must list two or three names");

  const writeAccess = obj.write_access;
  if (typeof writeAccess !== "boolean") fail(source, "write_access must be a boolean");
  if (writeAccess !== (tools.length > 0)) {
    fail(source, "write_access must be false exactly when tools is empty");
  }

  return {
    name,
    title,
    description,
    species_note: speciesNote,
    model: model as ModelEnvName,
    budget_share: budgetShare,
    voice,
    prompt_path: promptPath,
    tools,
    metrics,
    write_access: writeAccess,
  };
}

/** The model id for a spec: the value of the named environment variable. */
export function resolveModel(spec: Pick<RoleSpec, "model" | "name">, env: Env): string {
  const value = env[spec.model]?.trim();
  if (!value) {
    throw new Error(`${spec.name}: ${spec.model} is not set in .env`);
  }
  return value;
}

/** The nine launch shares must sum to 1 (within numeric tolerance). */
export function assertSharesSumToOne(specs: readonly RoleSpec[]): void {
  const total = specs.reduce((sum, s) => sum + s.budget_share, 0);
  if (Math.abs(total - 1) > 1e-6) {
    throw new Error(`budget_share values sum to ${total}, expected 1`);
  }
}
