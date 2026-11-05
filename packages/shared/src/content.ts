/** Content model shared by the content package, engine, server and admin UI. */

export const PACK_IDS = ["base", "dark-humor", "friendship-destroyer", "dating", "anime-gaming"] as const;
export type PackId = (typeof PACK_IDS)[number];

export const PROMPT_MODES = ["SPECTRUM", "DEBATE", "BLUFF", "FINALE"] as const;
export type PromptMode = (typeof PROMPT_MODES)[number];

export const CONTENT_RATINGS = ["SAFE", "MATURE"] as const;
export type ContentRating = (typeof CONTENT_RATINGS)[number];

export interface Prompt {
  id: string;
  packId: PackId;
  mode: PromptMode;
  /** Spectrum/bluff: the question. Debate/finale: the proposition being argued. */
  question: string;
  /** 0 end of the spectrum. For debate/finale prompts this is the "against" end. */
  leftLabel: string;
  /** 100 end of the spectrum. For debate/finale prompts this is the "for" end. */
  rightLabel: string;
  tags: string[];
  contentRating: ContentRating;
  streamSafe: boolean;
  /** 1 (gentle) – 5 (intense). */
  intensity: number;
  /** 1 (easy) – 3 (hard). */
  difficulty: number;
  language: "en";
  enabled: boolean;
}

/** Topic tags hosts and players can hide. Prompts reference these in `tags`. */
export const SENSITIVE_TOPICS = [
  "death",
  "religion",
  "politics",
  "alcohol",
  "drugs",
  "sex",
  "body-image",
  "money",
  "family",
  "exes",
  "work",
  "violence",
] as const;
export type SensitiveTopic = (typeof SENSITIVE_TOPICS)[number];

/** Metadata-only view of a prompt that is safe to send to a client in the store preview. */
export interface PromptPreview {
  id: string;
  packId: PackId;
  mode: PromptMode;
  question: string;
  leftLabel: string;
  rightLabel: string;
}
