import type { Prompt } from "@hps/shared";
import { basePack } from "./packs/base";
import { darkHumorPack } from "./packs/dark-humor";
import { friendshipDestroyerPack } from "./packs/friendship-destroyer";
import { datingPack } from "./packs/dating";
import { animeGamingPack } from "./packs/anime-gaming";

export * from "./filter";
export { definePack, type PromptSeed } from "./define";

export const PACK_META = [
  { id: "base", name: "Base Game", description: "The free core set. Stream-safe, every mode." },
  { id: "dark-humor", name: "Dark Humor", description: "Gallows jokes, curses and the afterlife." },
  { id: "friendship-destroyer", name: "Friendship Destroyer", description: "Loyalty, money and group-chat politics." },
  { id: "dating", name: "Dating & Relationships", description: "Dates, exes and relationship rules." },
  { id: "anime-gaming", name: "Anime & Gaming", description: "Fandom debates and gamer confessions." },
] as const;

/** All seeded prompts. Once seeded, the database is authoritative; this is the seed source and the memory-mode store. */
export const SEED_PROMPTS: readonly Prompt[] = [
  ...basePack,
  ...darkHumorPack,
  ...friendshipDestroyerPack,
  ...datingPack,
  ...animeGamingPack,
];
