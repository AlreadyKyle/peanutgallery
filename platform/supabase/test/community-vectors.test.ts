// The TypeScript side of the shared rarity and XP vectors (docs/specs/community-core.md): the site's
// platform/site/src/lib/rarity.ts and xp.ts give exactly test/fixtures/community-vectors.json, and
// functions/_shared/community_core_test.ts checks the SQL twins give the same. The published odds
// (common 70%, uncommon 20%, rare 8%, legendary 2%) hold over many ids.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE_LIB = resolve(HERE, "..", "..", "site", "src", "lib");
const vectors = JSON.parse(readFileSync(resolve(HERE, "fixtures", "community-vectors.json"), "utf8")) as {
  rarity: Record<string, string>;
  levels: { level: number; xp: number; tier: string }[];
  levelFor: { xp: number; level: number }[];
  contributionXp: { cents: number; rarity: string; xp: number }[];
};

// A runtime path, so this package's typecheck does not compile the site's modules.
type RarityModule = { cardRarity(id: string): Promise<string>; RARITY_ODDS: Record<string, number> };
type XpModule = {
  contributionXp(cents: number, rarity: string): number;
  xpForLevel(n: number): number;
  levelFor(xp: number): number;
  tierFor(level: number): string;
};
const load = async <T>(name: string): Promise<T> => (await import(/* @vite-ignore */ resolve(SITE_LIB, name))) as T;

describe("the shared community vectors, TypeScript side", () => {
  it("cardRarity gives every vector's rarity, and the vectors hold all four", async () => {
    const { cardRarity } = await load<RarityModule>("rarity.ts");
    for (const [id, rarity] of Object.entries(vectors.rarity)) expect(await cardRarity(id), id).toBe(rarity);
    expect(new Set(Object.values(vectors.rarity))).toEqual(new Set(["common", "uncommon", "rare", "legendary"]));
  });

  it("rarity is a pure function of the id with the published odds", async () => {
    const { cardRarity, RARITY_ODDS } = await load<RarityModule>("rarity.ts");
    expect(RARITY_ODDS).toEqual({ common: 0.7, uncommon: 0.2, rare: 0.08, legendary: 0.02 });
    const n = 20000;
    const counts: Record<string, number> = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
    for (let i = 0; i < n; i += 1) counts[await cardRarity(`odds-${i}`)]! += 1;
    for (const [rarity, odds] of Object.entries(RARITY_ODDS)) {
      // Within five standard deviations of the binomial mean.
      const sd = Math.sqrt(n * odds * (1 - odds));
      expect(Math.abs(counts[rarity]! - n * odds), rarity).toBeLessThan(5 * sd);
    }
    expect(await cardRarity("odds-1")).toBe(await cardRarity("odds-1"));
    // 20,000 digests take a few seconds when every package's tests run at once.
  }, 60_000);

  it("xp.ts gives every level, tier, level-for and contribution vector", async () => {
    const xp = await load<XpModule>("xp.ts");
    for (const v of vectors.levels) {
      expect(xp.xpForLevel(v.level), `level ${v.level}`).toBe(v.xp);
      expect(xp.tierFor(v.level), `tier ${v.level}`).toBe(v.tier);
    }
    for (const v of vectors.levelFor) expect(xp.levelFor(v.xp), `xp ${v.xp}`).toBe(v.level);
    for (const v of vectors.contributionXp) expect(xp.contributionXp(v.cents, v.rarity), `${v.cents} ${v.rarity}`).toBe(v.xp);
  });
});
