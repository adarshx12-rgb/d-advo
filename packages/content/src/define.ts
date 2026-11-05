import type { PackId, Prompt, PromptMode } from "@hps/shared";

export interface PromptSeed {
  q: string;
  /** 0 end. Defaults for DEBATE/FINALE: "Completely disagree". */
  l?: string;
  /** 100 end. Defaults for DEBATE/FINALE: "Completely agree". */
  r?: string;
  tags?: string[];
  /** Mature prompts are adult-only, never stream-safe, and only appear when the pack's NSFW toggle is on and every player opted in. */
  mature?: boolean;
  /** Safe but not ideal for a public stream (e.g. mild swearing). Defaults to true for SAFE prompts. */
  streamSafe?: boolean;
  intensity?: number;
  difficulty?: number;
}

const MODE_CODE: Record<PromptMode, string> = { SPECTRUM: "sp", DEBATE: "db", BLUFF: "bl", FINALE: "fn" };

/**
 * Builds prompts with stable ids: `<pack>:<mode>:<nn>` where nn is the position within that mode list.
 * Lists are append-only — never reorder or delete; disable a prompt with `enabled: false` in the admin instead.
 */
export function definePack(packId: PackId, modes: Partial<Record<PromptMode, PromptSeed[]>>): Prompt[] {
  const out: Prompt[] = [];
  for (const [mode, seeds] of Object.entries(modes) as [PromptMode, PromptSeed[]][]) {
    seeds.forEach((s, i) => {
      const isDebate = mode === "DEBATE" || mode === "FINALE";
      const mature = s.mature ?? false;
      out.push({
        id: `${packId}:${MODE_CODE[mode]}:${String(i + 1).padStart(2, "0")}`,
        packId,
        mode,
        question: s.q,
        leftLabel: s.l ?? (isDebate ? "Completely disagree" : "Not at all"),
        rightLabel: s.r ?? (isDebate ? "Completely agree" : "Completely"),
        tags: s.tags ?? [],
        contentRating: mature ? "MATURE" : "SAFE",
        streamSafe: mature ? false : (s.streamSafe ?? true),
        intensity: s.intensity ?? (mature ? 4 : 2),
        difficulty: s.difficulty ?? 2,
        language: "en",
        enabled: true,
      });
    });
  }
  return out;
}
