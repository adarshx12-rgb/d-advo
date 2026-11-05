import { describe, expect, it } from "vitest";
import { PACK_IDS, type PackId } from "@hps/shared";
import { SEED_PROMPTS, buildEligiblePool, checkPrompt, safeFallbackPool, type PromptFilterContext } from "../src";

const allOff = { base: false as const, "dark-humor": false, "friendship-destroyer": false, dating: false, "anime-gaming": false };

function ctx(over: Partial<PromptFilterContext> = {}): PromptFilterContext {
  return {
    ownedPackIds: [...PACK_IDS],
    enabledPackIds: [...PACK_IDS],
    nsfwByPack: allOff,
    everyPlayerConsentsToAdult: false,
    blockedTopics: [],
    maxIntensity: 5,
    language: "en",
    ...over,
  };
}

describe("seed content", () => {
  it("has 220 prompts with unique ids", () => {
    expect(SEED_PROMPTS).toHaveLength(220);
    expect(new Set(SEED_PROMPTS.map((p) => p.id)).size).toBe(220);
  });

  it("matches the per-pack targets", () => {
    const count = (pack: PackId) => SEED_PROMPTS.filter((p) => p.packId === pack).length;
    expect(count("base")).toBe(60);
    for (const pack of ["dark-humor", "friendship-destroyer", "dating", "anime-gaming"] as const) {
      expect(count(pack)).toBe(40);
      expect(SEED_PROMPTS.filter((p) => p.packId === pack && p.contentRating === "MATURE")).toHaveLength(10);
    }
  });

  it("keeps Base Game entirely stream-safe", () => {
    expect(SEED_PROMPTS.filter((p) => p.packId === "base").every((p) => p.contentRating === "SAFE" && p.streamSafe)).toBe(true);
  });

  it("never marks a mature prompt stream-safe", () => {
    expect(SEED_PROMPTS.filter((p) => p.contentRating === "MATURE").every((p) => !p.streamSafe)).toBe(true);
  });

  it("covers every mode with stream-safe prompts in every pack", () => {
    for (const pack of PACK_IDS) {
      for (const mode of ["SPECTRUM", "DEBATE", "BLUFF", "FINALE"] as const) {
        expect(SEED_PROMPTS.some((p) => p.packId === pack && p.mode === mode && p.streamSafe)).toBe(true);
      }
    }
  });
});

describe("NSFW filtering", () => {
  it("excludes all adult prompts when every toggle is off, even with full consent", () => {
    const pool = buildEligiblePool(SEED_PROMPTS, ctx({ everyPlayerConsentsToAdult: true }));
    expect(pool.some((p) => p.contentRating === "MATURE" || !p.streamSafe)).toBe(false);
  });

  it("keeps each pack's stream-safe theme when its toggle is off", () => {
    const pool = buildEligiblePool(SEED_PROMPTS, ctx());
    expect(pool.filter((p) => p.packId === "dark-humor")).toHaveLength(30);
  });

  it("toggles packs independently", () => {
    const pool = buildEligiblePool(
      SEED_PROMPTS,
      ctx({ nsfwByPack: { ...allOff, "friendship-destroyer": true }, everyPlayerConsentsToAdult: true }),
    );
    const mature = pool.filter((p) => p.contentRating === "MATURE");
    expect(mature).toHaveLength(10);
    expect(mature.every((p) => p.packId === "friendship-destroyer")).toBe(true);
  });

  it("requires every player's consent in addition to the host toggle", () => {
    const toggled = { ...allOff, dating: true };
    const without = buildEligiblePool(SEED_PROMPTS, ctx({ nsfwByPack: toggled, everyPlayerConsentsToAdult: false }));
    expect(without.some((p) => p.contentRating === "MATURE")).toBe(false);
    const datingMature = SEED_PROMPTS.find((p) => p.packId === "dating" && p.contentRating === "MATURE")!;
    expect(checkPrompt(datingMature, ctx({ nsfwByPack: toggled }))).toBe("ADULT_CONSENT_MISSING");
  });

  it("never treats Base Game as adult-capable", () => {
    const base = SEED_PROMPTS.find((p) => p.packId === "base")!;
    expect(
      checkPrompt({ ...base, contentRating: "MATURE", streamSafe: false }, ctx({ everyPlayerConsentsToAdult: true })),
    ).toBe("ADULT_PACK_TOGGLE_OFF");
  });
});

describe("ownership, topics and fallback", () => {
  it("excludes unowned packs even if enabled", () => {
    const pool = buildEligiblePool(SEED_PROMPTS, ctx({ ownedPackIds: ["base"] }));
    expect(pool.every((p) => p.packId === "base")).toBe(true);
  });

  it("excludes owned but disabled packs", () => {
    const pool = buildEligiblePool(SEED_PROMPTS, ctx({ enabledPackIds: ["base", "dating"] }));
    expect(new Set(pool.map((p) => p.packId))).toEqual(new Set(["base", "dating"]));
  });

  it("hides blocked topics and caps intensity", () => {
    const pool = buildEligiblePool(SEED_PROMPTS, ctx({ blockedTopics: ["death"], maxIntensity: 2 }));
    expect(pool.some((p) => p.tags.includes("death"))).toBe(false);
    expect(pool.every((p) => p.intensity <= 2)).toBe(true);
  });

  it("falls back to stream-safe Base Game only", () => {
    const pool = safeFallbackPool(SEED_PROMPTS, ctx());
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.every((p) => p.packId === "base" && p.streamSafe)).toBe(true);
  });
});
