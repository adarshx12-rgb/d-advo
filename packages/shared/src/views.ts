/**
 * Role-specific projections of the authoritative match state.
 * The server only ever sends these shapes; the full MatchState never leaves the server.
 */

export const PHASES = [
  "LOBBY",
  "CALIBRATION_PROMPT",
  "CALIBRATION_SUBMISSION",
  "CALIBRATION_PREDICTION",
  "CALIBRATION_DISCUSSION",
  "CALIBRATION_REVEAL",
  "CONTRACT_SELECTION",
  "COURT_PREPARATION",
  "COURT_OPENING",
  "COURT_REBUTTAL",
  "COURT_CHALLENGE",
  "COURT_CLOSING",
  "COURT_VOTING",
  "COURT_REVEAL",
  "BLUFF_PREPARATION",
  "BLUFF_STATEMENT",
  "BLUFF_DISCUSSION",
  "BLUFF_VOTING",
  "BLUFF_REVEAL",
  "FINALE_PREPARATION",
  "FINALE_DEBATE",
  "FINALE_INVESTIGATION",
  "FINALE_VOTING",
  "FINALE_REVEAL",
  "RESULTS",
] as const;
export type PhaseName = (typeof PHASES)[number];

export type Segment = "CALIBRATION" | "CONTRACTS" | "COURT" | "BLUFF" | "FINALE" | "RESULTS";

export type Side = "FOR" | "AGAINST";
export type DebaterSlot = "A" | "B";
export type BluffRole = "HONEST" | "BLUFF";

export type ChaosCardType = "SWITCH_SIDES" | "RECEIPTS" | "OBJECTION" | "CROSS_EXAMINATION";
export type ContractType = "MIND_LINK" | "SKEPTIC" | "KINGMAKER" | "FACT_CHECKER";

export type ScoreEventType =
  | "OPINION_PREDICTION"
  | "COURT_WIN"
  | "COURT_LOSS"
  | "JUDGE_VERDICT"
  | "JUDGE_PREDICTION"
  | "ANALYST_CALL"
  | "CONTRACT_SUCCESS"
  | "BLUFF_CORRECT"
  | "BLUFF_ESCAPE"
  | "BLUFF_CAUGHT"
  | "BLUFF_SPEAKER_COMPLETE"
  | "FINALE_DEBATE"
  | "FINALE_CLASSIFY"
  | "FINALE_INVESTIGATION"
  | "FINALE_VERDICT";

export interface PromptView {
  id: string;
  packId: string;
  question: string;
  leftLabel: string;
  rightLabel: string;
  mature: boolean;
}

export interface PlayerView {
  id: string;
  name: string;
  avatar: string;
  seat: number;
  connected: boolean;
  removed: boolean;
  score: number;
  charges: number;
}

export interface PhaseView {
  name: PhaseName;
  segment: Segment;
  /** Human label for the current step, e.g. "Opening — Alex". */
  label: string;
  /** Speaker currently holding the floor, if any. */
  speakerId: string | null;
  enteredAt: number;
  /** Server epoch ms. null = waits for the host (manual progression) or is paused. */
  deadline: number | null;
  paused: boolean;
  /** Remaining ms captured when paused. */
  pausedRemainingMs: number | null;
}

export interface ProgressView {
  segments: { key: Segment; label: string; status: "done" | "current" | "upcoming"; detail: string }[];
}

export interface VaultEntryView {
  id: string;
  playerId: string;
  promptQuestion: string;
  leftLabel: string;
  rightLabel: string;
  value: number;
  sourceLabel: string;
  visibility: "PRIVATE" | "REVEALED" | "EVIDENCE_ELIGIBLE";
}

export interface CalibrationRevealRow {
  playerId: string;
  opinion: number | null;
  predictorId: string;
  prediction: number | null;
  difference: number | null;
  points: number;
}

export interface CalibrationView {
  round: number;
  totalRounds: number;
  prompt: PromptView;
  /** Who predicts whom. Public — the hidden part is the numbers. */
  targets: { predictorId: string; targetId: string }[];
  opinionsLocked: string[];
  predictionsLocked: string[];
  reveal: CalibrationRevealRow[] | null;
  /** Histogram of opinions bucketed by 10, populated only at reveal. */
  distribution: number[] | null;
}

export interface HearingRevealView {
  winnerId: string;
  verdicts: { judgeId: string; winnerId: string | null }[];
  tiebreakUsed: boolean;
  stances: { playerId: string; value: number | null }[];
  predictions: { judgeId: string; targetId: string; value: number | null; points: number }[];
  analystCall: { analystId: string; pickedId: string | null; correct: boolean } | null;
}

export interface CourtView {
  hearingIndex: number;
  totalHearings: number;
  prompt: PromptView | null;
  debaterA: string;
  debaterB: string;
  /** Hidden until the openings begin. */
  sides: { A: Side; B: Side } | null;
  sidesSwapped: boolean;
  judges: string[];
  analystId: string | null;
  stancesLocked: string[];
  predictionsLocked: string[];
  votesIn: number;
  votesNeeded: number;
  evidence: VaultEntryView[];
  spectatorTally: { A: number; B: number } | null;
  reveal: HearingRevealView | null;
}

export interface BluffRevealView {
  role: BluffRole;
  genuine: number | null;
  claimed: number;
  votes: { playerId: string; guess: BluffRole | null; correct: boolean }[];
  speakerPoints: number;
}

export interface BluffView {
  turnIndex: number;
  totalTurns: number;
  speakerId: string;
  investigators: string[];
  prompt: PromptView | null;
  /** The number the speaker publicly claims. Shown from the statement onwards. */
  claim: number | null;
  speakerLocked: boolean;
  votesIn: number;
  votesNeeded: number;
  evidence: VaultEntryView[];
  spectatorTally: { HONEST: number; BLUFF: number } | null;
  reveal: BluffRevealView | null;
}

export type FinaleSeat = "DEBATER" | "LEAD_INVESTIGATOR" | "JUROR" | "INVESTIGATOR";

export interface FinaleRevealView {
  winnerId: string;
  tiebreakUsed: boolean;
  roles: { playerId: string; role: BluffRole; stance: number | null; side: Side }[];
  verdicts: { playerId: string; winnerId: string | null }[];
  classifications: { playerId: string; targetId: string; guess: BluffRole | null; correct: boolean }[];
  predictions: { playerId: string; targetId: string; value: number | null; points: number }[];
  winnerCalls: { playerId: string; pickedId: string | null; correct: boolean }[];
}

export interface FinaleView {
  prompt: PromptView | null;
  debaterA: string;
  debaterB: string;
  seats: { playerId: string; seat: FinaleSeat; multiplier: number }[];
  sides: { A: Side; B: Side } | null;
  stancesLocked: string[];
  predictionsLocked: string[];
  ballotsIn: number;
  ballotsNeeded: number;
  evidence: VaultEntryView[];
  spectatorTally: { A: number; B: number } | null;
  reveal: FinaleRevealView | null;
}

export interface PendingCardView {
  id: string;
  card: ChaosCardType;
  playedBy: string;
  targetLabel: string | null;
  stage: "COLLECTING" | "REACTION";
  resolvesAt: number;
}

export interface CardPlayView {
  id: string;
  card: ChaosCardType;
  playedBy: string;
  outcome: "RESOLVED" | "CANCELLED" | "OUTPRIORITIZED";
  cancelledBy: string | null;
  unitLabel: string;
  at: number;
  summary: string;
}

export interface TimelineEntry {
  id: string;
  at: number;
  kind:
    | "PHASE"
    | "CARD"
    | "EVIDENCE"
    | "VERDICT"
    | "REVEAL"
    | "SCORE"
    | "SYSTEM"
    | "CONTRACT";
  text: string;
}

export interface ScoreLine {
  id: string;
  playerId: string;
  type: ScoreEventType;
  amount: number;
  segment: Segment;
  label: string;
}

export interface ContractView {
  type: ContractType;
  title: string;
  description: string;
  targetPlayerId: string | null;
  status: "OFFERED" | "ACTIVE" | "COMPLETED" | "FAILED";
  reward: number;
}

export interface StandingRow {
  playerId: string;
  rank: number;
  total: number;
  byMode: Record<Segment, number>;
  successfulPredictions: number;
  debateWins: number;
  bluffCorrect: number;
  bluffEscapes: number;
  contractsCompleted: number;
  cardsUsed: number;
  sharedRank: boolean;
}

export interface ResultsView {
  winners: string[];
  standings: StandingRow[];
  contracts: { playerId: string; contract: ContractView | null }[];
  awards: { title: string; playerId: string; reason: string }[];
  spectatorLeaders: { name: string; points: number }[];
}

export interface PublicGameState {
  matchId: string;
  version: number;
  status: "IN_GAME" | "PAUSED" | "COMPLETED";
  serverNow: number;
  phase: PhaseView;
  progress: ProgressView;
  players: PlayerView[];
  calibration: CalibrationView | null;
  court: CourtView | null;
  bluff: BluffView | null;
  finale: FinaleView | null;
  pendingCard: PendingCardView | null;
  cardHistory: CardPlayView[];
  timeline: TimelineEntry[];
  scoreLines: ScoreLine[];
  contractsActive: number;
  results: ResultsView | null;
  chaosEnabled: boolean;
  contractsEnabled: boolean;
  /** Number of eligible "previous statements" that could be brought up as evidence. */
  evidencePoolSize: number;
}

export type LegalAction =
  | "SUBMIT_OPINION"
  | "SUBMIT_PREDICTION"
  | "SELECT_CONTRACT"
  | "COURT_LOCK_STANCE"
  | "JUDGE_PREDICT"
  | "COURT_VERDICT"
  | "ANALYST_CALL"
  | "YIELD_FLOOR"
  | "BLUFF_LOCK"
  | "BLUFF_VOTE"
  | "FINALE_LOCK_STANCE"
  | "FINALE_PREDICT"
  | "FINALE_VERDICT"
  | "FINALE_WINNER_CALL"
  | "FINALE_CLASSIFY"
  | "PLAY_CARD"
  | "REQUEST_SKIP";

export interface PrivateCourtInfo {
  role: "DEBATER" | "JUDGE" | "ANALYST";
  slot: DebaterSlot | null;
  mySide: Side | null;
  myStance: number | null;
  predictionTargetId: string | null;
  myPrediction: number | null;
  myVerdict: string | null;
  myCall: string | null;
}

export interface PrivateBluffInfo {
  role: "SPEAKER" | "INVESTIGATOR";
  myGenuine: number | null;
  /** Only present for the speaker, only after they lock their genuine answer. */
  instruction: { role: BluffRole; claim: number } | null;
  myVote: BluffRole | null;
}

export interface PrivateFinaleInfo {
  seat: FinaleSeat;
  slot: DebaterSlot | null;
  myStance: number | null;
  /** Debaters only, only after locking: whether their assigned side matches their real stance. */
  myRole: BluffRole | null;
  mySide: Side | null;
  predictionTargetId: string | null;
  myPrediction: number | null;
  myVerdict: string | null;
  myWinnerCall: string | null;
  myClassifications: { targetId: string; guess: BluffRole }[];
  classifyTargets: string[];
}

export interface PlayerPrivateState {
  playerId: string;
  isHost: boolean;
  legal: LegalAction[];
  /** Why a commonly expected action is not available right now. */
  hint: string | null;
  calibration: {
    myOpinion: number | null;
    keptPrivate: boolean;
    targetId: string | null;
    myPrediction: number | null;
  } | null;
  contractOffers: (ContractView & { offerId: string })[] | null;
  contract: ContractView | null;
  court: PrivateCourtInfo | null;
  bluff: PrivateBluffInfo | null;
  finale: PrivateFinaleInfo | null;
  charges: number;
  cardPlayedThisUnit: boolean;
  playableCards: ChaosCardType[];
  /** Vault entries this player may cite with Receipts right now. */
  receiptTargets: VaultEntryView[];
  crossExamTargets: string[];
  myVault: VaultEntryView[];
  skipRequestsLeft: number;
}

export interface PlayerGameState extends PublicGameState {
  me: PlayerPrivateState;
}

export interface HostGameState extends PlayerGameState {
  host: {
    canPause: boolean;
    canResume: boolean;
    canSkipPrompt: boolean;
    canAdvance: boolean;
    canEnd: boolean;
  };
}

export interface SpectatorGameState extends PublicGameState {
  spectator: {
    id: string;
    name: string;
    points: number;
    ballot: string | null;
    canVote: boolean;
    voteKind: "COURT" | "BLUFF" | "FINALE" | null;
  };
}
