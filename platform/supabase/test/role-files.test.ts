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
  it("reads sixteen valid specs with unique names and shares that sum to 1", async () => {
    const specs = await readRoleSpecs(AGENTS_DIR);
    expect(specs).toHaveLength(ROLE_COUNT);
    expect(ROLE_COUNT).toBe(16);
    expect(new Set(specs.map((s) => s.name)).size).toBe(ROLE_COUNT);
    expect(specs.reduce((sum, s) => sum + s.budget_share, 0)).toBeCloseTo(1, 6);
    expect(specs.filter((s) => s.budget_share === 0).map((s) => s.name).sort()).toEqual(
      ["Game Designer", "HR", "Head of Finance", "Head of Product", "Janitor", "Platform Director", "Tech Artist"],
    );
  });

  it("carries each role's place in the launch roster, with a trigger for every role that is not running", async () => {
    const specs = await readRoleSpecs(AGENTS_DIR);
    const byStatus = (status: string) => specs.filter((s) => s.status === status).map((s) => s.name).sort();
    expect(byStatus("running")).toEqual(["Builder A", "Builder B", "Game Designer", "Game Director", "Platform Builder", "Platform Director", "QA", "Studio Head"]);
    expect(byStatus("starts")).toEqual(["Biz Dev", "Community", "HR", "Head of Finance", "Head of Product", "Janitor", "Tech Artist"]);
    expect(byStatus("planned")).toEqual(["Host"]);
    for (const spec of specs) expect(spec.trigger === null, spec.name).toBe(spec.status === "running");
    expect(specs.find((s) => s.name === "Head of Finance")?.trigger).toMatch(/cutover/);
  });

  it("gives every role a description of its job, and leaves whether it runs to the site", async () => {
    const specs = await readRoleSpecs(AGENTS_DIR);
    for (const spec of specs) {
      expect(spec.description.length, spec.name).toBeGreaterThan(0);
      expect(spec.description.endsWith("."), spec.name).toBe(true);
    }
    const idle = specs.filter((s) => !s.write_access).map((s) => s.name).sort();
    expect(idle).toEqual(["Biz Dev", "Community", "Game Director", "HR", "Head of Finance", "Head of Product", "Host", "Janitor", "Platform Director", "Tech Artist"]);
    // The trust classes (docs/specs/agent-system-core.md), and write access exactly for a writer or planner with tools.
    const byClass = (klass: string) => specs.filter((s) => s.class === klass).map((s) => s.name).sort();
    expect(byClass("writer")).toEqual(["Builder A", "Builder B", "Platform Builder", "QA", "Tech Artist"]);
    expect(byClass("planner")).toEqual(["Game Designer", "HR", "Studio Head"]);
    expect(byClass("reviewer")).toEqual(["Game Director", "Platform Director"]);
    expect(byClass("read_only")).toEqual(["Head of Finance", "Janitor"]);
    expect(byClass("web_only")).toEqual(["Biz Dev", "Community", "Head of Product", "Host"]);
    for (const spec of specs) expect(spec.write_access, spec.name).toBe((spec.class === "writer" || spec.class === "planner") && spec.tools.length > 0);
    expect(specs.some((s) => s.name === "Scout")).toBe(false);
    // Running is a fact the site derives (Team.tsx, runsCards) and says once, as the heading a role
    // sits under; a description that also said it would repeat it, or go stale when the role starts.
    for (const spec of specs) {
      expect(spec.description, spec.name).not.toMatch(/not running/i);
    }
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

  it("rejects a directory that does not hold exactly sixteen specs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "role-files-"));
    try {
      const [first] = await readRoleSpecs(AGENTS_DIR);
      await writeFile(join(dir, "only.json"), JSON.stringify(first));
      await expect(readRoleSpecs(dir)).rejects.toThrow("Expected 16 role files in platform/agents, found 1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
