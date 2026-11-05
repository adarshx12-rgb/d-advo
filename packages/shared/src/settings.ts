import { z } from "zod";
import { PACK_IDS, SENSITIVE_TOPICS } from "./content";

export const MATCH_TYPES = ["FULL_SHOW", "OPINIONS_AND_COURT", "OPINIONS_AND_BLUFF"] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

export const MATCH_LENGTHS = ["QUICK", "STANDARD", "LONG"] as const;
export type MatchLength = (typeof MATCH_LENGTHS)[number];

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 12;

const packIdSchema = z.enum(PACK_IDS);

export const nsfwByPackSchema = z.object({
  base: z.literal(false).default(false),
  "dark-humor": z.boolean().default(false),
  "friendship-destroyer": z.boolean().default(false),
  dating: z.boolean().default(false),
  "anime-gaming": z.boolean().default(false),
});
export type NsfwByPack = z.infer<typeof nsfwByPackSchema>;

export const roomSettingsSchema = z.object({
  roomName: z.string().trim().min(1).max(40).default("Party Show"),
  maxPlayers: z.number().int().min(MIN_PLAYERS).max(MAX_PLAYERS).default(8),
  matchType: z.enum(MATCH_TYPES).default("FULL_SHOW"),
  matchLength: z.enum(MATCH_LENGTHS).default("STANDARD"),
  enabledPacks: z.array(packIdSchema).min(1).default(["base"]),
  /** Sample evenly across every enabled pack rather than weighting by pack size. */
  randomMix: z.boolean().default(true),
  /** Per-pack adult content toggle. All default OFF. Base Game can never be toggled on. */
  nsfwByPack: nsfwByPackSchema.default({
    base: false,
    "dark-humor": false,
    "friendship-destroyer": false,
    dating: false,
    "anime-gaming": false,
  }),
  blockedTopics: z.array(z.enum(SENSITIVE_TOPICS)).default([]),
  /** Highest prompt intensity (1–5) allowed in this room. */
  maxIntensity: z.number().int().min(1).max(5).default(5),
  audienceEnabled: z.boolean().default(true),
  /** 0 = advisory only (default). Reserved for future weighted audience modes. */
  spectatorVoteWeight: z.number().min(0).max(1).default(0),
  chaosEnabled: z.boolean().default(true),
  contractsEnabled: z.boolean().default(true),
  streamerMode: z.boolean().default(false),
  /** Seconds the broadcast view lags behind live play. */
  streamDelaySeconds: z.number().int().min(0).max(120).default(0),
  language: z.literal("en").default("en"),
  visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PRIVATE"),
  inviteOnly: z.boolean().default(false),
  progression: z.enum(["AUTO", "MANUAL"]).default("AUTO"),
});
export type RoomSettings = z.infer<typeof roomSettingsSchema>;

export function defaultRoomSettings(): RoomSettings {
  return roomSettingsSchema.parse({});
}

export const roomSettingsPatchSchema = roomSettingsSchema.partial();
export type RoomSettingsPatch = z.infer<typeof roomSettingsPatchSchema>;

export const AVATARS = [
  "gavel",
  "mask",
  "flame",
  "ghost",
  "crown",
  "rocket",
  "cat",
  "skull",
  "star",
  "bolt",
  "eye",
  "dice",
] as const;
export type AvatarId = (typeof AVATARS)[number];

export const ROOM_STATES = [
  "CREATED",
  "WAITING",
  "READY",
  "STARTING",
  "IN_GAME",
  "PAUSED",
  "COMPLETED",
  "CLOSED",
] as const;
export type RoomState = (typeof ROOM_STATES)[number];

function isUnsafeCodePoint(cp: number): boolean {
  return (
    cp <= 0x1f ||
    (cp >= 0x7f && cp <= 0x9f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x2028 && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069)
  );
}

/** Strip control/bidi characters, collapse whitespace and clamp length. Output is rendered as text, never HTML. */
export function sanitizeDisplayName(raw: string): string {
  const cleaned = Array.from(raw.normalize("NFKC"))
    .filter((ch) => !isUnsafeCodePoint(ch.codePointAt(0) ?? 0) && ch !== "<" && ch !== ">")
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(cleaned).slice(0, 20).join("");
}
