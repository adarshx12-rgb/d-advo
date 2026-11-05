import { describe, expect, it } from "vitest";
import {
  CATALOG,
  defaultRoomSettings,
  formatInr,
  gameActionSchema,
  roomJoinSchema,
  roomSettingsSchema,
  sanitizeDisplayName,
} from "../src";

describe("display names", () => {
  it("strips markup, control and bidi-override characters and trims", () => {
    expect(sanitizeDisplayName("  <b>Alex</b>  ")).toBe("bAlex/b");
    expect(sanitizeDisplayName("Ev‮il\u0000")).toBe("Evil");
  });
});

describe("game actions", () => {
  it("accepts 0–100 in steps of 5 only", () => {
    expect(gameActionSchema.safeParse({ type: "SUBMIT_OPINION", value: 35 }).success).toBe(true);
    expect(gameActionSchema.safeParse({ type: "SUBMIT_OPINION", value: 37 }).success).toBe(false);
    expect(gameActionSchema.safeParse({ type: "SUBMIT_OPINION", value: 105 }).success).toBe(false);
  });
  it("rejects unknown action types and cards", () => {
    expect(gameActionSchema.safeParse({ type: "GIVE_ME_POINTS" }).success).toBe(false);
    expect(gameActionSchema.safeParse({ type: "PLAY_CARD", card: "EXTRA_CHARGE" }).success).toBe(false);
  });
  it("normalises room codes", () => {
    expect(roomJoinSchema.parse({ code: " abcd " }).code).toBe("ABCD");
    expect(roomJoinSchema.safeParse({ code: "AB1D" }).success).toBe(false);
  });
});

describe("room settings", () => {
  it("defaults every adult toggle to off and Base Game can never be toggled on", () => {
    const d = defaultRoomSettings();
    expect(Object.values(d.nsfwByPack).every((v) => v === false)).toBe(true);
    expect(roomSettingsSchema.safeParse({ nsfwByPack: { ...d.nsfwByPack, base: true } }).success).toBe(false);
  });
});

describe("catalog", () => {
  it("prices everything in integer paise and the bundle stays unpriced", () => {
    for (const p of CATALOG) if (p.pricePaise !== null) expect(Number.isInteger(p.pricePaise)).toBe(true);
    expect(CATALOG.find((p) => p.kind === "BUNDLE")?.pricePaise ?? null).toBeNull();
    expect(formatInr(14900)).toBe("₹149");
  });
});
