// The model a role's session runs on, resolved when the session starts. Each role's spec in
// platform/agents/*.json names an env token (MODEL_BUILDER, MODEL_DIRECTOR or MODEL_HOST), and the
// token's value in the dispatcher's environment is the model, so changing the env and restarting the
// dispatcher changes the model without re-seeding the roles. roles.model, which the seed writes from
// the same env and /team displays, is used only for a role with no spec or a token the env leaves
// unset, and then MODEL_BUILDER. The specs are read from the dispatcher's own code root, which no card
// can write to.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { DispatcherConfig } from './config.js';
import type { Role } from './db.js';

export const MODEL_TOKENS = ['MODEL_BUILDER', 'MODEL_DIRECTOR', 'MODEL_HOST'] as const;

// The roles the board's role jobs run (studio_ranking, draft_card; docs/specs/agent-workflows.md).
// The Game Director grades with no write access, so startup checks their models by name as well.
export const ROLE_JOB_ROLES: readonly string[] = ['Studio Head', 'Game Designer', 'Game Director'];
export type ModelToken = (typeof MODEL_TOKENS)[number];

export function isModelToken(value: string): value is ModelToken {
  return (MODEL_TOKENS as readonly string[]).includes(value);
}

type ModelConfig = Pick<DispatcherConfig, 'codeRoot' | 'modelBuilder' | 'modelDirector' | 'modelHost'>;

export function tokenModel(config: ModelConfig, token: ModelToken): string | null {
  if (token === 'MODEL_BUILDER') return config.modelBuilder;
  if (token === 'MODEL_DIRECTOR') return config.modelDirector;
  return config.modelHost;
}

const tokensByRoot = new Map<string, ReadonlyMap<string, ModelToken>>();

// Role name to its spec's model token, read once per code root. A folder that cannot be read, or a
// spec that cannot be parsed, gives no token for that role.
export function roleModelTokens(codeRoot: string): ReadonlyMap<string, ModelToken> {
  const cached = tokensByRoot.get(codeRoot);
  if (cached) return cached;
  const tokens = new Map<string, ModelToken>();
  const dir = path.join(codeRoot, 'platform', 'agents');
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((file) => file.endsWith('.json'));
  } catch {
    files = [];
  }
  for (const file of files) {
    try {
      const spec = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as { name?: unknown; model?: unknown };
      if (typeof spec.name === 'string' && typeof spec.model === 'string' && isModelToken(spec.model)) tokens.set(spec.name, spec.model);
    } catch {
      // Not a role spec; skipped.
    }
  }
  tokensByRoot.set(codeRoot, tokens);
  return tokens;
}

export interface ResolvedModel {
  model: string;
  // env: from the role's token; role: roles.model; builder: MODEL_BUILDER.
  source: 'env' | 'role' | 'builder';
  token: ModelToken | null;
}

export function resolveRoleModel(role: Pick<Role, 'name' | 'model'>, config: ModelConfig): ResolvedModel {
  // A roles.model that is itself a token (a seed that stores tokens) resolves the same way.
  const token = roleModelTokens(config.codeRoot).get(role.name) ?? (isModelToken(role.model) ? role.model : null);
  const fromEnv = token ? tokenModel(config, token) : null;
  if (fromEnv) return { model: fromEnv, source: 'env', token };
  if (role.model && !isModelToken(role.model)) return { model: role.model, source: 'role', token };
  return { model: config.modelBuilder, source: 'builder', token };
}
