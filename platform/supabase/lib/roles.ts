// Role spec validation (platform/agents/<role>.json) and model resolution.

import type { Env } from "./env.js";

export const MODEL_ENV_NAMES = ["MODEL_DIRECTOR", "MODEL_BUILDER", "MODEL_HOST"] as const;
export type ModelEnvName = (typeof MODEL_ENV_NAMES)[number];

export const TOOL_NAMES = ["Read", "Edit", "Write", "Glob", "Grep", "Bash"] as const;
export const METRIC_NAMES = ["first_pass_rate", "cost_per_ship", "estimate_accuracy", "reopen_rate"] as const;
/** A role's place in the launch roster (platform/agents/README.md). */
export const ROLE_STATUSES = ["running", "starts", "planned"] as const;
export type RoleStatus = (typeof ROLE_STATUSES)[number];
/** A role's trust class (docs/SYSTEM.md, docs/specs/agent-system-core.md); roles.agent_class. */
export const ROLE_CLASSES = ["writer", "planner", "reviewer", "read_only", "web_only"] as const;
export type RoleClass = (typeof ROLE_CLASSES)[number];

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
  "class",
  "write_access",
  "status",
] as const;
/** Present exactly when status is not running. */
const OPTIONAL_KEYS = ["trigger"] as const;

/** The longest description roles.description accepts, and the longest trigger roles.trigger accepts. */
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
  /** The trust class; the seed writes it to roles.agent_class. */
  class: RoleClass;
  write_access: boolean;
  status: RoleStatus;
  /** One plain sentence saying when a role that is not running starts; null for a running role. */
  trigger: string | null;
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
    if (![...REQUIRED_KEYS, ...OPTIONAL_KEYS].includes(key as never)) fail(source, `unknown key ${key}`);
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
  if (typeof budgetShare !== "number" || !Number.isFinite(budgetShare) || budgetShare < 0 || budgetShare > 1) {
    fail(source, "budget_share must be a number from 0 to 1");
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

  const roleClass = nonEmptyString(source, obj, "class");
  if (!(ROLE_CLASSES as readonly string[]).includes(roleClass)) {
    fail(source, `class must be one of ${ROLE_CLASSES.join(", ")}`);
  }
  const writeAccess = obj.write_access;
  if (typeof writeAccess !== "boolean") fail(source, "write_access must be a boolean");
  if (writeAccess !== ((roleClass === "writer" || roleClass === "planner") && tools.length > 0)) {
    fail(source, "write_access must be true exactly when the class is writer or planner and tools is not empty");
  }

  const status = nonEmptyString(source, obj, "status");
  if (!(ROLE_STATUSES as readonly string[]).includes(status)) {
    fail(source, `status must be one of ${ROLE_STATUSES.join(", ")}`);
  }
  let trigger: string | null = null;
  if (status === "running") {
    if ("trigger" in obj) fail(source, "a running role has no trigger");
  } else {
    if (!("trigger" in obj)) fail(source, `a role that is ${status} must say its trigger`);
    trigger = nonEmptyString(source, obj, "trigger");
    if (trigger.includes("\n")) fail(source, "trigger must be one line");
    if (trigger.length > DESCRIPTION_MAX) fail(source, `trigger must be ${DESCRIPTION_MAX} characters or fewer`);
    if (trigger.trim() !== trigger) fail(source, "trigger must not start or end with a space");
    if (trigger.includes("\u2014")) fail(source, "trigger must not use an em dash");
    if (!trigger.endsWith(".")) fail(source, "trigger must end with a full stop");
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
    class: roleClass as RoleClass,
    write_access: writeAccess,
    status: status as RoleStatus,
    trigger,
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

/**
 * The shares of the roles with a share that is not 0 must sum to 1 (within numeric tolerance). The
 * roles added on 23 September 2026 carry 0 until the operations budget sets every share.
 */
export function assertSharesSumToOne(specs: readonly RoleSpec[]): void {
  const total = specs.filter((s) => s.budget_share !== 0).reduce((sum, s) => sum + s.budget_share, 0);
  if (Math.abs(total - 1) > 1e-6) {
    throw new Error(`budget_share values that are not 0 sum to ${total}, expected 1`);
  }
}
