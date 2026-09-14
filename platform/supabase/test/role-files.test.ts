import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readRoleSpecs, ROLE_COUNT } from "../lib/role-files.js";
import { MODEL_ENV_NAMES, resolveModel } from "../lib/roles.js";
import { WEEK1_EXECUTOR_ROLE } from "../lib/week1.js";

const AGENTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "agents");

describe("readRoleSpecs against platform/agents", () => {
  it("reads nine valid specs with unique names and shares that sum to 1", async () => {
    const specs = await readRoleSpecs(AGENTS_DIR);
    expect(specs).toHaveLength(ROLE_COUNT);
    expect(new Set(specs.map((s) => s.name)).size).toBe(ROLE_COUNT);
    expect(specs.reduce((sum, s) => sum + s.budget_share, 0)).toBeCloseTo(1, 6);
  });

  it("includes the week-1 executor role that seed.ts looks up by name", async () => {
    const specs = await readRoleSpecs(AGENTS_DIR);
    const executor = specs.find((s) => s.name === WEEK1_EXECUTOR_ROLE);
    expect(executor).toBeDefined();
    expect(executor?.write_access).toBe(true);
  });

  it("resolves every spec's model from one of the three environment names", async () => {
    const specs = await readRoleSpecs(AGENTS_DIR);
    const env = Object.fromEntries(MODEL_ENV_NAMES.map((name) => [name, `${name.toLowerCase()}-id`]));
    for (const spec of specs) {
      expect(resolveModel(spec, env)).toBe(`${spec.model.toLowerCase()}-id`);
    }
  });

  it("rejects a directory that does not hold exactly nine specs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "role-files-"));
    try {
      const [first] = await readRoleSpecs(AGENTS_DIR);
      await writeFile(join(dir, "only.json"), JSON.stringify(first));
      await expect(readRoleSpecs(dir)).rejects.toThrow("Expected 9 role files in platform/agents, found 1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
