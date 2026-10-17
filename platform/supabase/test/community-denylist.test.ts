// The community content filter carries the gate's deny-lists as digests only
// (docs/specs/community-core.md, Content filter): the digest migrations hold exactly what
// scripts/denylist-digests.mjs computes from platform/gate/denylist today, and no term itself.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain .mjs script with no type declarations.
import { denylistDigests } from "../scripts/denylist-digests.mjs";

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

describe("the community deny-list digests", () => {
  it("the digest migrations hold exactly the script's digests", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => /_community_digests\w*\.sql$/.test(f)).sort();
    expect(files.length).toBeGreaterThan(0);
    const inMigrations = new Set<string>();
    for (const f of files) for (const m of readFileSync(resolve(MIGRATIONS, f), "utf8").matchAll(/\('([0-9a-f]{64})'\)/g)) inMigrations.add(m[1]!);
    expect([...inMigrations].sort()).toEqual(denylistDigests() as string[]);
  });

  it("no community migration spells out a deny-list term", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.includes("_community_"));
    const text = files.map((f) => readFileSync(resolve(MIGRATIONS, f), "utf8")).join("\n").toLowerCase();
    // A few terms of each kind, spelt in parts so this file does not carry them either.
    for (const parts of [["sh", "it"], ["fu", "ck"], ["co", "caine"]]) expect(text).not.toMatch(new RegExp(`\\b${parts.join("")}\\b`));
  });
});
