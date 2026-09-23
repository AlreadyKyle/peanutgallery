// A role job's typed answer (docs/specs/agent-workflows.md). Claude Code has no custom tools, so an
// attended session answers in its final message, which must be exactly one JSON object valid against
// the job's schema in platform/agents/schemas/. The schemas are read from this process's own checkout,
// never from a worktree an agent can change, and validated with ajv; anything else fails the run
// with nothing written.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';

export const SCHEMA_NAMES = ['card-draft', 'ranking', 'draft-verdict'] as const;
export type SchemaName = (typeof SCHEMA_NAMES)[number];

// platform/agents in the checkout this file runs from.
export const AGENTS_DIR = path.resolve(import.meta.dirname, '..', '..', 'agents');

export function schemaFile(name: SchemaName, agentsDir: string = AGENTS_DIR): string {
  return path.join(agentsDir, 'schemas', `${name}.schema.json`);
}

// The repository path a prompt names the schema by.
export function schemaRepoPath(name: SchemaName): string {
  return `platform/agents/schemas/${name}.schema.json`;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// The answer with surrounding white space and, at most, one fenced code block around it removed:
// the fence is formatting, and what is inside must still be the one object.
export function unwrapAnswer(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/.exec(trimmed);
  return (fenced ? fenced[1]! : trimmed).trim();
}

export class TypedOutput {
  private readonly validators = new Map<SchemaName, ValidateFunction>();
  private readonly texts = new Map<SchemaName, string>();

  constructor(agentsDir: string = AGENTS_DIR) {
    const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
    for (const name of SCHEMA_NAMES) {
      const text = readFileSync(schemaFile(name, agentsDir), 'utf8');
      this.texts.set(name, text.trim());
      this.validators.set(name, ajv.compile(JSON.parse(text) as object));
    }
  }

  // The schema as the prompt shows it.
  schemaText(name: SchemaName): string {
    return this.texts.get(name)!;
  }

  // The session's final message as one object valid against the schema, or why it is not.
  parse<T>(name: SchemaName, text: string | null | undefined): Parsed<T> {
    if (typeof text !== 'string' || text.trim() === '') return { ok: false, error: 'the session ended with no final message' };
    let value: unknown;
    try {
      value = JSON.parse(unwrapAnswer(text));
    } catch {
      return { ok: false, error: 'the final message is not exactly one JSON object' };
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, error: 'the final message is not exactly one JSON object' };
    const validate = this.validators.get(name)!;
    if (!validate(value)) {
      const errors = (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`);
      return { ok: false, error: `the final message is not valid against ${name}.schema.json: ${errors.slice(0, 5).join('; ')}` };
    }
    return { ok: true, value: value as T };
  }
}
