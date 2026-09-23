// Reads the sixteen roster role specs from platform/agents/*.json. Shared by
// seed.ts and its test so both validate the same files the same way.

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertSharesSumToOne, parseRoleSpec, type RoleSpec } from "./roles.js";

export const ROLE_COUNT = 16;

/** Every *.json file in the directory, parsed and validated; exactly sixteen, unique names, the shares that are not 0 summing to 1. */
export async function readRoleSpecs(agentsDir: string): Promise<RoleSpec[]> {
  const files = (await readdir(agentsDir)).filter((f) => f.endsWith(".json")).sort();
  const specs: RoleSpec[] = [];
  for (const file of files) {
    const text = await readFile(resolve(agentsDir, file), "utf8");
    specs.push(parseRoleSpec(JSON.parse(text), `platform/agents/${file}`));
  }
  if (specs.length !== ROLE_COUNT) {
    throw new Error(`Expected ${ROLE_COUNT} role files in platform/agents, found ${specs.length}`);
  }
  const names = new Set(specs.map((s) => s.name));
  if (names.size !== specs.length) {
    throw new Error("Role names must be unique across platform/agents");
  }
  assertSharesSumToOne(specs);
  return specs;
}
