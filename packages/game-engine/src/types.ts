import type {
  BluffRole,
  ChaosCardType,
  ContractType,
  FinaleSeat,
  GameEventMessage,
  PhaseName,
  Prompt,
  ScoreEventType,
  Segment,
  Side,
  TimelineEntry,
  GameActionInput,
} from "@hps/shared";
import type { MatchConfig } from "./config";

export interface EnginePlayer {
  id: string;
  name: string;
  avatar: string;
  seat: number;
  connected: boolean;
  removed: boolean;
}

export interface PhaseState {
  name: PhaseName;
  /** Sub-step within a phase (e.g. speaker A then B). */
  step: number;
  enteredAt: number;
  deadline: number | null;
  pausedRemainingMs: number | null;
  /** The floor-holder asked to finish early but a card was still resolving. */
  yieldRequested: boolean;
}

export interface CalibrationRound {
  index: number;
  prompt: Prompt;
  /** predictorId -> targetId */
  targets: Record<string, string>;
  opinions: Record<string, { value: number; keepPrivate: boolean }>;
  predictions: Record<string, number>;
  revealed: boolean;
}

export interface HearingResult {
  winnerId: string;
  loserId: string;
  tiebreakUsed: boolean;
}

export interface Hearing {
  index: number;
  debaterA: string;
  debaterB: string;
  judges: string[];
  /** A non-voting seat that calls the winner. Only created for a KINGMAKER contract. */
  analystId: string | null;
  /** judgeId (or analystId) -> the debater whose locked stance they predict */
  predictionTargets: Record<string, string>;
  /** Side debater A argues before any Switch Sides. Committed when the schedule is generated. */
  sideA: Side;
  /** Neutral tiebreaker committed at schedule time, used only if the verdict is split. */
  tiebreakSlot: "A" | "B";
  prompt: Prompt | null;
  stances: Record<string, number>;
  predictions: Record<string, number>;
  verdicts: Record<string, string>;
  analystCall: string | null;
  swapped: boolean;
  evidence: string[];
  receiptsResolved: { playerId: string; entryId: string }[];
  result: HearingResult | null;
}

export interface BluffTurn {
  index: number;
  speakerId: string;
  investigators: string[];
  /** Committed at phase start. The speaker never chooses it. */
  role: BluffRole;
  /** Committed fabrication distance and direction, applied once the genuine answer is locked. */
  fabricationOffset: number;
  fabricationUp: boolean;
  prompt: Prompt | null;
  genuine: number | null;
  claim: number | null;
  votes: Record<string, BluffRole>;
  evidence: string[];
  result: { speakerPoints: number; escaped: boolean } | null;
}

export interface FinaleState {
  prompt: Prompt | null;
  debaterA: string;
  debaterB: string;
  seats: Record<string, FinaleSeat>;
  multipliers: Record<string, number>;
  sideA: Side;
  tiebreakSlot: "A" | "B";
  stances: Record<string, number>;
  /** Derived after stances lock: HONEST if the assigned side matches the locked stance. */
  roles: Record<string, BluffRole>;
  predictionTargets: Record<string, string>;
  predictions: Record<string, number>;
  verdicts: Record<string, string>;
  winnerCalls: Record<string, string>;
  classifications: Record<string, Record<string, BluffRole>>;
  evidence: string[];
  result: HearingResult | null;
}

export type VaultVisibility = "PRIVATE" | "REVEALED" | "EVIDENCE_ELIGIBLE";

export interface VaultEntry {
  id: string;
  matchId: string;
  playerId: string;
  promptId: string;
  promptSnapshot: string;
  leftLabel: string;
  rightLabel: string;
  value: number;
  sourceLabel: string;
  sourceRound: string;
  visibility: VaultVisibility;
  /** False when the player kept the answer private — it is then never stored as evidence. */
  revealEligible: boolean;
  createdAt: number;
}

export interface PendingCompetitor {
  playId: string;
  card: ChaosCardType;
  playedBy: string;
  targetEntryId: string | null;
  targetPlayerId: string | null;
  receivedAt: number;
}

export interface PendingCard extends PendingCompetitor {
  unitKey: string;
  stage: "COLLECTING" | "REACTION";
  resolvesAt: number;
  competitors: PendingCompetitor[];
}

export interface CardPlayRecord {
  id: string;
  card: ChaosCardType;
  playedBy: string;
  unitKey: string;
  unitLabel: string;
  outcome: "RESOLVED" | "CANCELLED" | "OUTPRIORITIZED";
  cancelledBy: string | null;
  at: number;
  summary: string;
}

export interface ChaosState {
  charges: Record<string, number>;
  pending: PendingCard | null;
  history: CardPlayRecord[];
  /** unitKey -> players who spent their one card for that hearing/turn. */
  playedInUnit: Record<string, string[]>;
}

export interface ContractOffer {
  offerId: string;
  type: ContractType;
  targetPlayerId: string | null;
  hearingIndex: number | null;
  bluffTurnIndex: number | null;
}

export interface ContractState {
  offers: ContractOffer[];
  selected: ContractOffer | null;
  status: "OFFERED" | "ACTIVE" | "COMPLETED" | "FAILED";
}

export interface ScoreEvent {
  /** Deterministic id; the same rule firing twice can never double count. */
  id: string;
  playerId: string;
  type: ScoreEventType;
  amount: number;
  segment: Segment;
  label: string;
  /** Inputs needed to re-derive the amount (no free-text private data). */
  detail: Record<string, number | string | boolean | null>;
  at: number;
}

export interface SpectatorRecord {
  id: string;
  name: string;
  points: number;
  ballots: Record<string, string>;
}

export interface MatchState {
  matchId: string;
  seed: string;
  rngState: number;
  version: number;
  status: "IN_GAME" | "PAUSED" | "COMPLETED";
  hostId: string;
  config: MatchConfig;
  createdAt: number;
  players: EnginePlayer[];
  phase: PhaseState;
  calibration: { rounds: CalibrationRound[]; current: number };
  contracts: Record<string, ContractState>;
  court: { hearings: Hearing[]; current: number };
  bluff: { turns: BluffTurn[]; current: number };
  finale: FinaleState | null;
  vault: VaultEntry[];
  chaos: ChaosState;
  scoreEvents: ScoreEvent[];
  timeline: TimelineEntry[];
  promptPool: Prompt[];
  fallbackPool: Prompt[];
  usedPromptIds: string[];
  skipRequests: Record<string, number>;
  spectators: Record<string, SpectatorRecord>;
  /** Most recent action ids, for idempotency. */
  processedActionIds: string[];
  counter: number;
}

export interface EngineResult {
  state: MatchState;
  events: GameEventMessage[];
}

export type EngineAction =
  | { kind: "PLAYER"; actorId: string; actionId: string; action: GameActionInput }
  | { kind: "SPECTATOR_VOTE"; spectatorId: string; spectatorName: string; actionId: string; choice: string }
  | { kind: "HOST"; actorId: string; actionId: string; command: "PAUSE" | "RESUME" | "SKIP_PROMPT" | "ADVANCE" | "END" }
  | { kind: "CONNECTION"; playerId: string; connected: boolean }
  | { kind: "REMOVE_PLAYER"; playerId: string }
  | { kind: "SET_HOST"; playerId: string }
  | { kind: "UPDATE_POOL"; pool: Prompt[] };

export class EngineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
