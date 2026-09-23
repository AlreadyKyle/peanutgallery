import { describe, expect, it } from "vitest";
import { assertSharesSumToOne, parseRoleSpec, resolveModel, type RoleSpec } from "../lib/roles.js";

// The Builder A launch spec from platform/agents/builder-a.json, as parsed: a running role has no trigger.
const builderA: RoleSpec = {
  name: "Builder A",
  title: "Builder A",
  description: "Builds funded game cards as small, tested changes to Dust, taking turns with Builder B.",
  species_note: "A small blue creature with two round antennae and stubby legs.",
  model: "MODEL_BUILDER",
  budget_share: 0.2,
  voice: "plain",
  prompt_path: "platform/agents/prompts/builder-a.md",
  tools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
  metrics: ["first_pass_rate", "cost_per_ship", "estimate_accuracy"],
  class: "writer",
  write_access: true,
  status: "running",
  trigger: null,
};

// The same file as written: the key is absent.
const { trigger: _builderTrigger, ...builderAFile } = builderA;

// The Host spec from platform/agents/host.json: planned, so it says its trigger.
const host: RoleSpec = {
  name: "Host",
  title: "Host",
  description: "Narrates the studio's work on a live stream and speaks up for chat, but is not running yet.",
  species_note: "A round pink creature with large ears and a wide mouth.",
  model: "MODEL_HOST",
  budget_share: 0.05,
  voice: "cheerful",
  prompt_path: "platform/agents/prompts/host.md",
  tools: [],
  metrics: ["first_pass_rate", "cost_per_ship"],
  class: "web_only",
  write_access: false,
  status: "planned",
  trigger: "No trigger is set yet; the Host waits on the stream, a backlog entry.",
};

describe("parseRoleSpec", () => {
  it("accepts a write role and a read-only role", () => {
    expect(parseRoleSpec(builderAFile, "builder-a.json")).toEqual(builderA);
    expect(parseRoleSpec(host, "host.json")).toEqual(host);
  });

  it("rejects a missing key", () => {
    const { voice: _voice, ...withoutVoice } = builderAFile;
    expect(() => parseRoleSpec(withoutVoice, "builder-a.json")).toThrow("missing key voice");
  });

  it("rejects a missing description, and one that is not a single plain line of at most 200 characters", () => {
    const { description: _description, ...withoutDescription } = builderAFile;
    expect(() => parseRoleSpec(withoutDescription, "builder-a.json")).toThrow("missing key description");
    expect(() => parseRoleSpec({ ...builderAFile, description: " " }, "x.json")).toThrow("description must be a non-empty string");
    expect(() => parseRoleSpec({ ...builderAFile, description: "One.\nTwo." }, "x.json")).toThrow("description must be one line");
    expect(() => parseRoleSpec({ ...builderAFile, description: `${"a".repeat(200)}.` }, "x.json")).toThrow("200 characters or fewer");
    expect(() => parseRoleSpec({ ...builderAFile, description: " Builds cards." }, "x.json")).toThrow("start or end with a space");
    expect(() => parseRoleSpec({ ...builderAFile, description: "Builds cards \u2014 small ones." }, "x.json")).toThrow("em dash");
    expect(parseRoleSpec({ ...builderAFile, description: `${"a".repeat(199)}.` }, "x.json").description).toHaveLength(200);
  });

  it("rejects an unknown key", () => {
    expect(() => parseRoleSpec({ ...builderAFile, backstory: "none" }, "builder-a.json")).toThrow("unknown key backstory");
  });

  it("rejects a model that is not an environment name", () => {
    expect(() => parseRoleSpec({ ...builderAFile, model: "claude-sonnet" }, "builder-a.json")).toThrow("model must be one of");
  });

  it("rejects metrics outside the scored set and wrong counts", () => {
    expect(() => parseRoleSpec({ ...builderAFile, metrics: ["first_pass_rate", "velocity"] }, "x.json")).toThrow("unknown value");
    expect(() => parseRoleSpec({ ...builderAFile, metrics: ["first_pass_rate"] }, "x.json")).toThrow("two or three");
    expect(() => parseRoleSpec({ ...builderAFile, metrics: ["first_pass_rate", "first_pass_rate"] }, "x.json")).toThrow("repeated");
  });

  it("rejects tools outside the allowlist", () => {
    expect(() => parseRoleSpec({ ...builderAFile, tools: ["Read", "WebFetch"] }, "x.json")).toThrow("unknown value");
  });

  it("ties write_access to the class and a non-empty tools list (docs/specs/agent-system-core.md)", () => {
    expect(() => parseRoleSpec({ ...builderAFile, tools: [] }, "x.json")).toThrow("write_access");
    expect(() => parseRoleSpec({ ...host, write_access: true }, "x.json")).toThrow("write_access");
    // A reviewer with read tools has no write access; a planner with them has.
    const reviewer = { ...builderAFile, class: "reviewer", tools: ["Read", "Glob", "Grep"] };
    expect(() => parseRoleSpec({ ...reviewer, write_access: true }, "x.json")).toThrow("write_access");
    expect(parseRoleSpec({ ...reviewer, write_access: false }, "x.json").class).toBe("reviewer");
    expect(parseRoleSpec({ ...reviewer, class: "planner", write_access: true }, "x.json").write_access).toBe(true);
  });

  it("requires a class from the five trust classes", () => {
    const { class: _class, ...withoutClass } = builderAFile;
    expect(() => parseRoleSpec(withoutClass, "x.json")).toThrow("missing key class");
    expect(() => parseRoleSpec({ ...builderAFile, class: "admin" }, "x.json")).toThrow("class must be one of writer, planner, reviewer, read_only, web_only");
  });

  it("rejects a multi-line species note, a bad voice, a bad prompt path and a bad share", () => {
    expect(() => parseRoleSpec({ ...host, species_note: "one\ntwo" }, "x.json")).toThrow("one line");
    expect(() => parseRoleSpec({ ...host, voice: "Cheerful" }, "x.json")).toThrow("lowercase word");
    expect(() => parseRoleSpec({ ...host, prompt_path: "prompts/host.md" }, "x.json")).toThrow("prompt_path");
    expect(parseRoleSpec({ ...host, budget_share: 0 }, "x.json").budget_share).toBe(0);
    expect(() => parseRoleSpec({ ...host, budget_share: -0.1 }, "x.json")).toThrow("budget_share");
    expect(() => parseRoleSpec({ ...host, budget_share: 1.5 }, "x.json")).toThrow("budget_share");
  });

  it("requires a status from the roster, and a one-line trigger exactly when the role is not running", () => {
    const { status: _status, ...withoutStatus } = builderAFile;
    expect(() => parseRoleSpec(withoutStatus, "x.json")).toThrow("missing key status");
    expect(() => parseRoleSpec({ ...builderAFile, status: "paused" }, "x.json")).toThrow("status must be one of running, starts, planned");
    expect(() => parseRoleSpec({ ...builderAFile, trigger: "Starts later." }, "x.json")).toThrow("a running role has no trigger");
    const { trigger: _trigger, ...hostWithoutTrigger } = host;
    expect(() => parseRoleSpec(hostWithoutTrigger, "x.json")).toThrow("must say its trigger");
    expect(() => parseRoleSpec({ ...host, status: "starts", trigger: " " }, "x.json")).toThrow("trigger must be a non-empty string");
    expect(() => parseRoleSpec({ ...host, trigger: "One.\nTwo." }, "x.json")).toThrow("trigger must be one line");
    expect(() => parseRoleSpec({ ...host, trigger: `${"a".repeat(200)}.` }, "x.json")).toThrow("200 characters or fewer");
    expect(() => parseRoleSpec({ ...host, trigger: "Starts later \u2014 maybe." }, "x.json")).toThrow("em dash");
    expect(() => parseRoleSpec({ ...host, trigger: "Starts later" }, "x.json")).toThrow("full stop");
    expect(parseRoleSpec({ ...host, status: "starts", trigger: "Starts at the cutover." }, "x.json")).toMatchObject({ status: "starts", trigger: "Starts at the cutover." });
  });

  it("rejects non-objects", () => {
    expect(() => parseRoleSpec([builderAFile], "x.json")).toThrow("JSON object");
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
  it("accepts the nine launch shares beside roles that carry 0", () => {
    const shares = [0.1, 0.1, 0.2, 0.2, 0.15, 0.15, 0.05, 0.025, 0.025, 0, 0, 0, 0, 0, 0, 0];
    expect(() => assertSharesSumToOne(shares.map((budget_share) => ({ ...host, budget_share })))).not.toThrow();
  });

  it("rejects shares that are not 0 and do not sum to 1", () => {
    expect(() => assertSharesSumToOne([builderA, host, { ...host, budget_share: 0 }])).toThrow("sum to 0.25");
  });
});
