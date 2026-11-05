import { z } from "zod";
import { AVATARS, roomSettingsPatchSchema, type RoomSettings, type RoomState } from "./settings";
import { SENSITIVE_TOPICS, type PackId } from "./content";
import type {
  HostGameState,
  PlayerGameState,
  PublicGameState,
  SpectatorGameState,
  ChaosCardType,
} from "./views";

/* ------------------------------------------------------------------ */
/* Client -> server payloads                                           */
/* ------------------------------------------------------------------ */

const value0to100 = z
  .number()
  .int()
  .min(0)
  .max(100)
  .refine((v) => v % 5 === 0, "Values move in steps of 5");

const displayName = z.string().min(1).max(40);
const avatar = z.enum(AVATARS);
const roomCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}$/, "Room codes are four letters");
const id = z.string().min(1).max(64);
export const actionIdSchema = z.string().min(8).max(64);

export const roomCreateSchema = z.object({
  displayName,
  avatar,
  settings: roomSettingsPatchSchema.optional(),
});

export const roomJoinSchema = z.object({
  code: roomCode,
  displayName: displayName.optional(),
  avatar: avatar.optional(),
  inviteKey: z.string().max(64).optional(),
  as: z.enum(["player", "spectator", "broadcast"]).default("player"),
});

export const settingsUpdateSchema = z.object({ patch: roomSettingsPatchSchema });
export const readySchema = z.object({ ready: z.boolean() });
export const profileSchema = z.object({ displayName, avatar });
export const consentSchema = z.object({
  adultContent: z.boolean(),
  ageConfirmed: z.boolean(),
  hiddenTopics: z.array(z.enum(SENSITIVE_TOPICS)).max(SENSITIVE_TOPICS.length),
});
export const targetPlayerSchema = z.object({ playerId: id });

export const gameActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SUBMIT_OPINION"), value: value0to100, keepPrivate: z.boolean().default(false) }),
  z.object({ type: z.literal("SUBMIT_PREDICTION"), value: value0to100 }),
  z.object({ type: z.literal("SELECT_CONTRACT"), offerId: id }),
  z.object({ type: z.literal("COURT_LOCK_STANCE"), value: value0to100 }),
  z.object({ type: z.literal("JUDGE_PREDICT"), value: value0to100 }),
  z.object({ type: z.literal("COURT_VERDICT"), winnerId: id }),
  z.object({ type: z.literal("ANALYST_CALL"), winnerId: id }),
  z.object({ type: z.literal("YIELD_FLOOR") }),
  z.object({ type: z.literal("BLUFF_LOCK"), value: value0to100 }),
  z.object({ type: z.literal("BLUFF_VOTE"), guess: z.enum(["HONEST", "BLUFF"]) }),
  z.object({ type: z.literal("FINALE_LOCK_STANCE"), value: value0to100 }),
  z.object({ type: z.literal("FINALE_PREDICT"), value: value0to100 }),
  z.object({ type: z.literal("FINALE_VERDICT"), winnerId: id }),
  z.object({ type: z.literal("FINALE_WINNER_CALL"), winnerId: id }),
  z.object({ type: z.literal("FINALE_CLASSIFY"), targetId: id, guess: z.enum(["HONEST", "BLUFF"]) }),
  z.object({
    type: z.literal("PLAY_CARD"),
    card: z.enum(["SWITCH_SIDES", "RECEIPTS", "OBJECTION", "CROSS_EXAMINATION"]),
    targetEntryId: id.optional(),
    targetPlayerId: id.optional(),
  }),
  z.object({ type: z.literal("REQUEST_SKIP") }),
]);
export type GameActionInput = z.infer<typeof gameActionSchema>;

export const gameActionEnvelopeSchema = z.object({
  actionId: actionIdSchema,
  /** Version of the state the client acted on. Stale versions are still accepted when the action stays legal. */
  matchVersion: z.number().int().nonnegative().optional(),
  action: gameActionSchema,
});

export const spectatorVoteSchema = z.object({
  actionId: actionIdSchema,
  choice: z.string().min(1).max(64),
});

export const reportSchema = z.object({
  kind: z.enum(["PROMPT", "PLAYER"]),
  promptId: id.optional(),
  playerId: id.optional(),
  reason: z.string().trim().min(3).max(500),
});

export const hostActionSchema = z.object({ actionId: actionIdSchema.optional() });

export const timePingSchema = z.object({ clientSentAt: z.number() });

/* ------------------------------------------------------------------ */
/* Server -> client payloads                                           */
/* ------------------------------------------------------------------ */

export interface RoomMemberView {
  id: string;
  name: string;
  avatar: string;
  isHost: boolean;
  ready: boolean;
  connected: boolean;
}

export interface PackAvailability {
  packId: PackId;
  name: string;
  owned: boolean;
  pricePaise: number | null;
  enabled: boolean;
  nsfw: boolean;
  hasMatureContent: boolean;
  safePromptCount: number;
  maturePromptCount: number;
}

export interface BrandingView {
  logoUrl: string | null;
  accentColor: string;
  secondaryColor: string;
  lobbyHeader: string | null;
  resultsTagline: string | null;
}

export interface RoomView {
  code: string;
  state: RoomState;
  settings: RoomSettings;
  hostId: string | null;
  members: RoomMemberView[];
  spectatorCount: number;
  packs: PackAvailability[];
  /** Adult content is only live when a pack's toggle is on AND every player consented. */
  adultContent: {
    anyPackToggled: boolean;
    consentedCount: number;
    playerCount: number;
    active: boolean;
  };
  canStart: boolean;
  startBlockers: string[];
  branding: BrandingView | null;
  matchActive: boolean;
  /** Only sent to the host. */
  inviteKey: string | null;
  /** The receiving member's own consent settings. */
  myConsent: { adultContent: boolean; ageConfirmed: boolean; hiddenTopics: string[] } | null;
  myId: string | null;
  myRole: "player" | "spectator" | "broadcast";
}

export type GameEventKind =
  | "PHASE_CHANGED"
  | "CARD_PLAYED"
  | "CARD_RESOLVED"
  | "CARD_CANCELLED"
  | "EVIDENCE_REVEALED"
  | "VOTING_CLOSED"
  | "WINNER_REVEALED"
  | "SCORES_UPDATED"
  | "CONTRACT_RESOLVED"
  | "MATCH_COMPLETED"
  | "PAUSED"
  | "RESUMED";

export interface GameEventMessage {
  kind: GameEventKind;
  at: number;
  text: string;
  /** Only public data. */
  data?: Record<string, unknown>;
}

export type Ack<T = void> = (res: { ok: true; data: T } | { ok: false; error: string }) => void;

export interface ClientToServerEvents {
  "room:create": (p: z.infer<typeof roomCreateSchema>, ack: Ack<{ code: string }>) => void;
  "room:join": (p: z.input<typeof roomJoinSchema>, ack: Ack<{ code: string; role: string }>) => void;
  "room:leave": (ack?: Ack) => void;
  "room:settings": (p: z.input<typeof settingsUpdateSchema>, ack: Ack) => void;
  "player:ready": (p: z.infer<typeof readySchema>, ack: Ack) => void;
  "player:profile": (p: z.infer<typeof profileSchema>, ack: Ack) => void;
  "player:consent": (p: z.infer<typeof consentSchema>, ack: Ack) => void;
  "host:start": (ack: Ack) => void;
  "host:kick": (p: z.infer<typeof targetPlayerSchema>, ack: Ack) => void;
  "host:transfer": (p: z.infer<typeof targetPlayerSchema>, ack: Ack) => void;
  "host:pause": (ack: Ack) => void;
  "host:resume": (ack: Ack) => void;
  "host:skipPrompt": (ack: Ack) => void;
  "host:advance": (ack: Ack) => void;
  "host:end": (ack: Ack) => void;
  "host:returnToLobby": (ack: Ack) => void;
  "game:action": (p: z.input<typeof gameActionEnvelopeSchema>, ack: Ack<{ version: number }>) => void;
  "spectator:vote": (p: z.infer<typeof spectatorVoteSchema>, ack: Ack) => void;
  "state:request": (ack: Ack) => void;
  "report:submit": (p: z.infer<typeof reportSchema>, ack: Ack) => void;
  "time:ping": (p: z.infer<typeof timePingSchema>, ack: Ack<{ serverNow: number }>) => void;
}

export interface ServerToClientEvents {
  "room:updated": (room: RoomView) => void;
  "room:closed": (p: { reason: string }) => void;
  "room:removed": (p: { reason: string }) => void;
  "game:state": (state: PlayerGameState | HostGameState | SpectatorGameState | PublicGameState) => void;
  "game:event": (e: GameEventMessage) => void;
  "game:cleared": () => void;
  "error:message": (p: { message: string }) => void;
}

export type { ChaosCardType };
