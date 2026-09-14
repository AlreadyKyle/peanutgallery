import { describe, expect, it } from "vitest";
import { assertSharesSumToOne, parseRoleSpec, resolveModel, type RoleSpec } from "../lib/roles.js";

// The Builder A launch spec from platform/agents/builder-a.json.
const builderA: RoleSpec = {
  name: "Builder A",
  title: "Builder A",
  species_note: "A small blue creature with two round antennae and stubby legs.",
  model: "MODEL_BUILDER",
  budget_share: 0.2,
  voice: "plain",
  prompt_path: "platform/agents/prompts/builder-a.md",
  tools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
  metrics: ["first_pass_rate", "cost_per_ship", "estimate_accuracy"],
  write_access: true,
};

// The Host launch spec from platform/agents/host.json.
const host: RoleSpec = {
  name: "Host",
  title: "Host",
  species_note: "A round pink creature with large ears and a wide mouth.",
  model: "MODEL_HOST",
  budget_share: 0.05,
  voice: "cheerful",
  prompt_path: "platform/agents/prompts/host.md",
  tools: [],
  metrics: ["first_pass_rate", "cost_per_ship"],
  write_access: false,
};

describe("parseRoleSpec", () => {
  it("accepts a write role and a read-only role", () => {
    expect(parseRoleSpec(builderA, "builder-a.json")).toEqual(builderA);
    expect(parseRoleSpec(host, "host.json")).toEqual(host);
  });

  it("rejects a missing key", () => {
    const { voice: _voice, ...withoutVoice } = builderA;
    expect(() => parseRoleSpec(withoutVoice, "builder-a.json")).toThrow("missing key voice");
  });

  it("rejects an unknown key", () => {
    expect(() => parseRoleSpec({ ...builderA, backstory: "none" }, "builder-a.json")).toThrow("unknown key backstory");
  });

  it("rejects a model that is not an environment name", () => {
    expect(() => parseRoleSpec({ ...builderA, model: "claude-sonnet" }, "builder-a.json")).toThrow("model must be one of");
  });

  it("rejects metrics outside the scored set and wrong counts", () => {
    expect(() => parseRoleSpec({ ...builderA, metrics: ["first_pass_rate", "velocity"] }, "x.json")).toThrow("unknown value");
    expect(() => parseRoleSpec({ ...builderA, metrics: ["first_pass_rate"] }, "x.json")).toThrow("two or three");
    expect(() => parseRoleSpec({ ...builderA, metrics: ["first_pass_rate", "first_pass_rate"] }, "x.json")).toThrow("repeated");
  });

  it("rejects tools outside the allowlist", () => {
    expect(() => parseRoleSpec({ ...builderA, tools: ["Read", "WebFetch"] }, "x.json")).toThrow("unknown value");
  });

  it("ties write_access to a non-empty tools list", () => {
    expect(() => parseRoleSpec({ ...builderA, tools: [] }, "x.json")).toThrow("write_access");
    expect(() => parseRoleSpec({ ...host, write_access: true }, "x.json")).toThrow("write_access");
  });

  it("rejects a multi-line species note, a bad voice, a bad prompt path and a bad share", () => {
    expect(() => parseRoleSpec({ ...host, species_note: "one\ntwo" }, "x.json")).toThrow("one line");
    expect(() => parseRoleSpec({ ...host, voice: "Cheerful" }, "x.json")).toThrow("lowercase word");
    expect(() => parseRoleSpec({ ...host, prompt_path: "prompts/host.md" }, "x.json")).toThrow("prompt_path");
    expect(() => parseRoleSpec({ ...host, budget_share: 0 }, "x.json")).toThrow("budget_share");
    expect(() => parseRoleSpec({ ...host, budget_share: 1.5 }, "x.json")).toThrow("budget_share");
  });

  it("rejects non-objects", () => {
    expect(() => parseRoleSpec([builderA], "x.json")).toThrow("JSON object");
    expect(() => parseRoleSpec(null, "x.json")).toThrow("JSON object");
  });
});

describe("resolveModel", () => {
  it("reads the model id from the named environment variable", () => {
    expect(resolveModel(builderA, { MODEL_BUILDER: "builder-model-id" })).toBe("builder-model-id");
    expect(resolveModel(host, { MODEL_HOST: " host-model-id " })).toBe("host-model-id");
  });

  it("fails when the variable is empty or absent", () => {
    expect(() => resolveModel(builderA, { MODEL_BUILDER: "" })).toThrow("MODEL_BUILDER is not set");
    expect(() => resolveModel(builderA, {})).toThrow("Builder A: MODEL_BUILDER is not set");
  });
});

describe("assertSharesSumToOne", () => {
  it("accepts the nine launch shares", () => {
    const shares = [0.1, 0.1, 0.2, 0.2, 0.15, 0.15, 0.05, 0.025, 0.025];
    expect(() => assertSharesSumToOne(shares.map((budget_share) => ({ ...host, budget_share })))).not.toThrow();
  });

  it("rejects shares that do not sum to 1", () => {
    expect(() => assertSharesSumToOne([builderA, host])).toThrow("sum to 0.25");
  });
});
