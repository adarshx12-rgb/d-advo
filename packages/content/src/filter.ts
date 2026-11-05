import type { NsfwByPack, PackId, Prompt, PromptMode } from "@hps/shared";

export interface PromptFilterContext {
  /** Packs the host owns (Base Game is always owned). */
  ownedPackIds: readonly PackId[];
  /** Packs the host enabled for this room. */
  enabledPackIds: readonly PackId[];
  /** Per-pack adult toggle set by the host. */
  nsfwByPack: NsfwByPack;
  /** True only when every participating player affirmatively opted in AND confirmed they are adults. */
  everyPlayerConsentsToAdult: boolean;
  /** Union of host-blocked and player-hidden topics. */
  blockedTopics: readonly string[];
  maxIntensity: number;
  language: "en";
}

export type IneligibleReason =
  | "DISABLED"
  | "NOT_OWNED"
  | "PACK_DISABLED"
  | "WRONG_MODE"
  | "LANGUAGE"
  | "ADULT_PACK_TOGGLE_OFF"
  | "ADULT_CONSENT_MISSING"
  | "TOPIC_BLOCKED"
  | "TOO_INTENSE";

/** Anything that is not both SAFE and stream-safe counts as adult content and needs every gate. */
export function isAdultPrompt(p: Prompt): boolean {
  return p.contentRating !== "SAFE" || !p.streamSafe;
}

/**
 * Single source of truth for whether a prompt may be delivered to a room.
 * Runs on the server before any payload is built — the client never receives an ineligible prompt.
 */
export function checkPrompt(p: Prompt, ctx: PromptFilterContext, mode?: PromptMode): IneligibleReason | null {
  if (!p.enabled) return "DISABLED";
  if (mode && p.mode !== mode) return "WRONG_MODE";
  if (p.language !== ctx.language) return "LANGUAGE";
  if (p.packId !== "base" && !ctx.ownedPackIds.includes(p.packId)) return "NOT_OWNED";
  if (!ctx.enabledPackIds.includes(p.packId)) return "PACK_DISABLED";
  if (isAdultPrompt(p)) {
    if (p.packId === "base" || !ctx.nsfwByPack[p.packId]) return "ADULT_PACK_TOGGLE_OFF";
    if (!ctx.everyPlayerConsentsToAdult) return "ADULT_CONSENT_MISSING";
  }
  if (p.intensity > ctx.maxIntensity) return "TOO_INTENSE";
  if (p.tags.some((t) => ctx.blockedTopics.includes(t))) return "TOPIC_BLOCKED";
  return null;
}

export function buildEligiblePool(prompts: readonly Prompt[], ctx: PromptFilterContext): Prompt[] {
  return prompts.filter((p) => checkPrompt(p, ctx) === null);
}

export function countByMode(pool: readonly Prompt[]): Record<PromptMode, number> {
  const out: Record<PromptMode, number> = { SPECTRUM: 0, DEBATE: 0, BLUFF: 0, FINALE: 0 };
  for (const p of pool) out[p.mode]++;
  return out;
}

/**
 * Fallback when a mode runs dry: stream-safe prompts from Base Game (always owned).
 * Never introduces adult content and never introduces unowned packs.
 */
export function safeFallbackPool(prompts: readonly Prompt[], ctx: PromptFilterContext): Prompt[] {
  return prompts.filter(
    (p) =>
      p.enabled &&
      p.packId === "base" &&
      !isAdultPrompt(p) &&
      p.language === ctx.language &&
      !p.tags.some((t) => ctx.blockedTopics.includes(t)),
  );
}
