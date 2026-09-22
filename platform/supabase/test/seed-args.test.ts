import { describe, expect, it } from "vitest";
import { parseSeedArgs, UsageError } from "../lib/seed-args.js";

describe("parseSeedArgs", () => {
  it("defaults to a plain seed with run 1", () => {
    const options = parseSeedArgs([]);
    expect(options.week1Test).toBe(false);
    expect(options.run.run).toBe(1);
  });

  it("accepts --week1-test with --run N or --run=N", () => {
    expect(parseSeedArgs(["--week1-test"]).run.unit).toBe("gatherer");
    expect(parseSeedArgs(["--week1-test", "--run", "2"]).run.unit).toBe("forge");
    expect(parseSeedArgs(["--run=3", "--week1-test"]).run.unit).toBe("mill");
  });

  it("raises a UsageError for --run without --week1-test", () => {
    expect(() => parseSeedArgs(["--run", "2"])).toThrow(UsageError);
    expect(() => parseSeedArgs(["--run", "2"])).toThrow("--run is only valid together with --week1-test");
  });

  it("raises a UsageError for an unknown argument or run number", () => {
    expect(() => parseSeedArgs(["--verbose"])).toThrow(UsageError);
    expect(() => parseSeedArgs(["--verbose"])).toThrow("Unknown argument --verbose");
    expect(() => parseSeedArgs(["--week1-test", "--run", "4"])).toThrow(UsageError);
    expect(() => parseSeedArgs(["--week1-test", "--run", "4"])).toThrow("--run must be 1, 2 or 3");
  });

  it("skips the -- that pnpm passes through, as in the documented pnpm seed -- --week1-test", () => {
    expect(parseSeedArgs(["--", "--week1-test", "--run", "2"]).run.unit).toBe("forge");
  });

  it("raises a UsageError for --run with no value instead of defaulting to run 1", () => {
    expect(() => parseSeedArgs(["--week1-test", "--run"])).toThrow("--run needs a value");
  });
});
