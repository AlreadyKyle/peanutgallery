import { describe, expect, it } from "vitest";
import { parseBoardMembers, parseEmailList, requireEnv, requireUsd, todayInNewYork } from "../lib/env.js";

describe("requireEnv and requireUsd", () => {
  it("returns trimmed values and rejects empty ones", () => {
    expect(requireEnv({ AGENT_MODE: " attended " }, "AGENT_MODE")).toBe("attended");
    expect(() => requireEnv({ AGENT_MODE: "" }, "AGENT_MODE")).toThrow("AGENT_MODE is not set");
    expect(() => requireEnv({}, "AGENT_MODE")).toThrow("AGENT_MODE is not set");
  });

  it("parses dollar amounts to four decimals and rejects bad values", () => {
    expect(requireUsd({ CARD_MAX_USD: "25" }, "CARD_MAX_USD")).toBe(25);
    expect(requireUsd({ CARD_MAX_USD: "0.12345" }, "CARD_MAX_USD")).toBe(0.1235);
    expect(() => requireUsd({ CARD_MAX_USD: "twenty" }, "CARD_MAX_USD")).toThrow("number of dollars");
    expect(() => requireUsd({ CARD_MAX_USD: "-1" }, "CARD_MAX_USD")).toThrow("number of dollars");
  });
});

describe("parseEmailList", () => {
  it("lowercases, trims, de-duplicates and drops empties", () => {
    expect(parseEmailList(" Board@PeanutGallery.games, second@peanutgallery.games ,board@peanutgallery.games,,")).toEqual([
      "board@peanutgallery.games",
      "second@peanutgallery.games",
    ]);
    expect(parseEmailList(undefined)).toEqual([]);
    expect(parseEmailList("")).toEqual([]);
  });

  it("rejects values that are not addresses", () => {
    expect(() => parseEmailList("board")).toThrow("not an email address");
  });
});

describe("parseBoardMembers", () => {
  it("builds board rows and one moderator row", () => {
    expect(parseBoardMembers("board@peanutgallery.games", "mod@peanutgallery.games")).toEqual([
      { email: "board@peanutgallery.games", role: "board" },
      { email: "mod@peanutgallery.games", role: "moderator" },
    ]);
  });

  it("omits the moderator when MODERATOR_EMAIL is empty", () => {
    expect(parseBoardMembers("board@peanutgallery.games", "")).toEqual([{ email: "board@peanutgallery.games", role: "board" }]);
    expect(parseBoardMembers("board@peanutgallery.games", undefined)).toEqual([{ email: "board@peanutgallery.games", role: "board" }]);
  });

  it("keeps a board member as board when the same address is also the moderator", () => {
    expect(parseBoardMembers("board@peanutgallery.games", "BOARD@peanutgallery.games")).toEqual([
      { email: "board@peanutgallery.games", role: "board" },
    ]);
  });

  it("requires at least one board email", () => {
    expect(() => parseBoardMembers("", "mod@peanutgallery.games")).toThrow("BOARD_EMAILS");
  });
});

describe("todayInNewYork", () => {
  it("uses the New York calendar date, not UTC", () => {
    expect(todayInNewYork(new Date("2026-09-14T03:30:00Z"))).toBe("2026-09-13");
    expect(todayInNewYork(new Date("2026-09-14T04:30:00Z"))).toBe("2026-09-14");
    expect(todayInNewYork(new Date("2026-01-15T04:30:00Z"))).toBe("2026-01-14");
    expect(todayInNewYork(new Date("2026-01-15T05:30:00Z"))).toBe("2026-01-15");
  });
});
